*"* Behavior pool ZBP_I_MATMASS_STAWN, tab "Local Types" (replace the generated content with this file).
*"*
*"* Static action setCode( Material, Plant, Code ) sets the commodity code of a material for the country of the plant.
*"* The app calls it once per material/plant; all plants of one material in one change set (one LUW).
*"* A rejected item comes back with MessageType 'E' and the reason in Message (no FAILED), so the result reaches the app.
*"*
*"* Where the code lives: in S/4HANA every read of MARC-STAWN goes through proxy view NSDM_V_MARC (CDS NSDM_E_MARC),
*"* which returns /SAPSLL/MARITC-CCNGN (first 17 characters) for the numbering scheme of the plant's country
*"* (/SAPSLL/TUNOS, CTSTY '01'), valid today (note 3026397). The physical MARC-STAWN is not read (DS4 test 8 Oct 2026).
*"* So the classification is maintained in /SAPSLL/MARITC through SAP's API /SAPSLL/API_COMCO_CLS_DISTR (note 2458080,
*"* delta mode), one code per material and numbering scheme:
*"*   - new code: the current record ends yesterday, the new code is valid from today to 31.12.9999
*"*     (a current record that starts today is changed instead);
*"*   - "" clears: the current record ends yesterday (or is deleted if it starts today).
*"* Checked here before anything is planned: M_MATE_WRK activity 02 for the plant, M_MATE_MAT activity 02 if the
*"* material has an authorization group, material, plant and numbering scheme exist, the code exists in
*"* /SAPSLL/CLSNR for the scheme (spaces ignored: 84099900 finds "840999 00"), no future-dated classification.
*"* The API commits itself (BOPF save), which is not allowed in the RAP save phase: it is called IN BACKGROUND TASK
*"* (tRFC, destination NONE) and runs right after the commit of the change set. Its own messages (e.g. product locked)
*"* do not reach the app; failed calls are visible in SM58.

"! Requests collected in the interaction phase, sent to the API in the save phase.
CLASS lcl_buffer DEFINITION FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_request,
             matnr TYPE matnr,
             stcts TYPE /sapsll/stcts,
             comco TYPE /sapsll/comco,
             plant TYPE werks_d,
           END OF ty_request,
           tt_request TYPE SORTED TABLE OF ty_request WITH UNIQUE KEY matnr stcts.
    CLASS-DATA requests TYPE tt_request.
    CLASS-DATA lines    TYPE /sapsll/api_comco_cls_distr_st.
    CLASS-METHODS clear.
ENDCLASS.

CLASS lcl_buffer IMPLEMENTATION.
  METHOD clear.
    CLEAR: requests, lines.
  ENDMETHOD.
ENDCLASS.

CLASS lhc_stawn DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_global_authorizations FOR GLOBAL AUTHORIZATION
      IMPORTING REQUEST requested_authorizations FOR Stawn RESULT result.

    METHODS lock FOR LOCK
      IMPORTING keys FOR LOCK Stawn.

    METHODS read FOR READ
      IMPORTING keys FOR READ Stawn RESULT result.

    METHODS setcode FOR MODIFY
      IMPORTING keys FOR ACTION Stawn~setCode RESULT result.

    "! Checks and buffers one item; never raises, the outcome is in the result.
    METHODS process
      IMPORTING is_in         TYPE za_matmass_stawn_p
      RETURNING VALUE(rs_out) TYPE za_matmass_stawn_r.
ENDCLASS.

CLASS lhc_stawn IMPLEMENTATION.

  METHOD get_global_authorizations.
    " the detailed checks (M_MATE_WRK / M_MATE_MAT) run per item in PROCESS
    IF requested_authorizations-%action-setCode = if_abap_behv=>mk-on.
      result-%action-setCode = if_abap_behv=>auth-allowed.
    ENDIF.
  ENDMETHOD.

  METHOD lock.
    " not used by the static action; required for the lock master
    LOOP AT keys INTO DATA(ls_key).
      CALL FUNCTION 'ENQUEUE_EMMARCE'
        EXPORTING
          matnr          = ls_key-Material
          werks          = ls_key-Plant
        EXCEPTIONS
          foreign_lock   = 1
          system_failure = 2
          OTHERS         = 3.
      IF sy-subrc <> 0.
        APPEND VALUE #( Material = ls_key-Material Plant = ls_key-Plant ) TO failed-stawn.
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD read.
    IF keys IS INITIAL.
      RETURN.
    ENDIF.
    SELECT * FROM zi_matmass_stawn
      FOR ALL ENTRIES IN @keys
      WHERE Material = @keys-Material
        AND Plant    = @keys-Plant
      INTO CORRESPONDING FIELDS OF TABLE @result.
  ENDMETHOD.

  METHOD setcode.
    LOOP AT keys INTO DATA(ls_key).
      DATA(ls_out) = process( CORRESPONDING #( ls_key-%param ) ).
      APPEND VALUE #( %cid   = ls_key-%cid
                      %param = CORRESPONDING #( ls_out ) ) TO result.
    ENDLOOP.
  ENDMETHOD.

  METHOD process.
    DATA lv_matnr TYPE matnr.
    DATA lv_begru TYPE begru.
    DATA lv_land1 TYPE land1.
    DATA lv_stcts TYPE /sapsll/stcts.
    DATA lv_nosct TYPE /sapsll/nosct.
    DATA lv_code  TYPE /sapsll/comco.
    DATA ls_cur   TYPE /sapsll/maritc.
    DATA lv_input TYPE string.
    DATA lv_like  TYPE string.

    DATA(lv_today)     = sy-datum.
    DATA(lv_yesterday) = CONV d( sy-datum - 1 ).

    rs_out = CORRESPONDING #( is_in ).
    rs_out-changed     = abap_false.
    rs_out-messagetype = 'E'.

    " material number as entered (1080626) -> internal format (leading zeros)
    CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
      EXPORTING
        input        = is_in-material
      IMPORTING
        output       = lv_matnr
      EXCEPTIONS
        length_error = 1
        OTHERS       = 2.
    IF sy-subrc <> 0.
      rs_out-message = |Material { is_in-material }: invalid material number|.
      RETURN.
    ENDIF.

    " authorization per plant and, if the material has one, per authorization group
    AUTHORITY-CHECK OBJECT 'M_MATE_WRK'
      ID 'ACTVT' FIELD '02'
      ID 'WERKS' FIELD is_in-plant.
    IF sy-subrc <> 0.
      rs_out-message = |No authorization to change material data in plant { is_in-plant } (M_MATE_WRK)|.
      RETURN.
    ENDIF.
    SELECT SINGLE begru FROM mara WHERE matnr = @lv_matnr INTO @lv_begru.
    IF sy-subrc <> 0.
      rs_out-message = |Material { is_in-material } does not exist|.
      RETURN.
    ENDIF.
    IF lv_begru IS NOT INITIAL.
      AUTHORITY-CHECK OBJECT 'M_MATE_MAT'
        ID 'ACTVT' FIELD '02'
        ID 'BEGRU' FIELD lv_begru.
      IF sy-subrc <> 0.
        rs_out-message = |No authorization for authorization group { lv_begru } of material { is_in-material } (M_MATE_MAT)|.
        RETURN.
      ENDIF.
    ENDIF.

    " numbering scheme of the plant's country, as in proxy view NSDM_E_MARC
    SELECT SINGLE land1 FROM t001w WHERE werks = @is_in-plant INTO @lv_land1.
    IF sy-subrc <> 0.
      rs_out-message = |Plant { is_in-plant } does not exist|.
      RETURN.
    ENDIF.
    SELECT SINGLE stcts FROM /sapsll/tunos
      WHERE land1 = @lv_land1 AND ctsty = '01'
      INTO @lv_stcts.
    IF sy-subrc <> 0.
      rs_out-message = |No commodity code numbering scheme for country { lv_land1 } of plant { is_in-plant } (/SAPSLL/TUNOS)|.
      RETURN.
    ENDIF.

    " current classification (valid today)
    SELECT SINGLE * FROM /sapsll/maritc
      WHERE matnr = @lv_matnr AND stcts = @lv_stcts
        AND datab <= @lv_today AND datbi >= @lv_today
      INTO @ls_cur.
    DATA(lv_has_cur) = xsdbool( sy-subrc = 0 ).
    rs_out-previous = ls_cur-ccngn.

    " the code as maintained for the scheme (/SAPSLL/CLSNR, valid today); spaces in the input are ignored
    lv_input = condense( val = is_in-code del = ` ` to = `` ).
    IF lv_input IS NOT INITIAL.
      SELECT SINGLE nosct FROM /sapsll/nosca
        WHERE stcts = @lv_stcts AND datab <= @lv_today AND datbi >= @lv_today
        INTO @lv_nosct.
      IF sy-subrc <> 0.
        rs_out-message = |Numbering scheme { lv_stcts } has no valid content today (/SAPSLL/NOSCA)|.
        RETURN.
      ENDIF.
      lv_like = substring( val = lv_input len = 1 ) && `%`.
      SELECT ccngn FROM /sapsll/clsnr
        WHERE nosct = @lv_nosct AND ccngn LIKE @lv_like
          AND datab <= @lv_today AND datbi >= @lv_today
        INTO TABLE @DATA(lt_codes).
      LOOP AT lt_codes INTO DATA(ls_code).
        IF condense( val = ls_code-ccngn del = ` ` to = `` ) = lv_input.
          lv_code = ls_code-ccngn.
          EXIT.
        ENDIF.
      ENDLOOP.
      IF lv_code IS INITIAL.
        rs_out-message = |Commodity code "{ is_in-code }" does not exist in numbering scheme { lv_stcts } today (/SAPSLL/CLSNR)|.
        RETURN.
      ENDIF.
    ENDIF.
    rs_out-code = lv_code.

    " one code per material and scheme: plants of the same country in this request must agree
    READ TABLE lcl_buffer=>requests INTO DATA(ls_req) WITH TABLE KEY matnr = lv_matnr stcts = lv_stcts.
    IF sy-subrc = 0.
      IF ls_req-comco = lv_code.
        rs_out-messagetype = 'S'.
        rs_out-message     = |Same commodity code as plant { ls_req-plant } (one code per material for scheme { lv_stcts })|.
      ELSE.
        rs_out-message = |Plant { ls_req-plant } already sets "{ ls_req-comco }" for scheme { lv_stcts }; one code per material and country|.
      ENDIF.
      RETURN.
    ENDIF.

    IF lv_code = ls_cur-ccngn.
      rs_out-messagetype = 'S'.
      rs_out-message     = 'unchanged'.
      RETURN.
    ENDIF.

    " a classification that starts in the future would overlap; leave that to manual maintenance
    SELECT COUNT(*) FROM /sapsll/maritc
      WHERE matnr = @lv_matnr AND stcts = @lv_stcts AND datab > @lv_today.
    IF sy-dbcnt > 0.
      rs_out-message = |Material { is_in-material } has a future-dated classification for scheme { lv_stcts }; maintain it manually|.
      RETURN.
    ENDIF.

    " lines for /SAPSLL/API_COMCO_CLS_DISTR (delta mode)
    IF lv_has_cur = abap_true.
      IF ls_cur-datab < lv_today.
        " current record ends yesterday
        INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = ls_cur-ccngn
                        datab = ls_cur-datab datbi = lv_yesterday ) INTO TABLE lcl_buffer=>lines.
        IF lv_code IS NOT INITIAL.
          INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = lv_code
                          datab = lv_today datbi = '99991231' ) INTO TABLE lcl_buffer=>lines.
        ENDIF.
      ELSEIF lv_code IS NOT INITIAL.
        " current record starts today: change its code
        INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = lv_code
                        datab = ls_cur-datab datbi = ls_cur-datbi ) INTO TABLE lcl_buffer=>lines.
      ELSE.
        " current record starts today and the code is cleared: delete it
        INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = ls_cur-ccngn
                        datab = ls_cur-datab datbi = ls_cur-datbi deletion = abap_true ) INTO TABLE lcl_buffer=>lines.
      ENDIF.
    ELSE.
      INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = lv_code
                      datab = lv_today datbi = '99991231' ) INTO TABLE lcl_buffer=>lines.
    ENDIF.
    INSERT VALUE #( matnr = lv_matnr stcts = lv_stcts comco = lv_code plant = is_in-plant ) INTO TABLE lcl_buffer=>requests.

    rs_out-changed     = abap_true.
    rs_out-messagetype = 'S'.
    rs_out-message     = COND #( WHEN lv_code IS INITIAL
                                 THEN |Commodity code of scheme { lv_stcts } ends { lv_yesterday DATE = USER }|
                                 ELSE |Commodity code for scheme { lv_stcts } valid from { lv_today DATE = USER }| ).
  ENDMETHOD.

ENDCLASS.

CLASS lsc_zi_matmass_stawn DEFINITION INHERITING FROM cl_abap_behavior_saver.
  PROTECTED SECTION.
    METHODS finalize          REDEFINITION.
    METHODS check_before_save REDEFINITION.
    METHODS save              REDEFINITION.
    METHODS cleanup           REDEFINITION.
    METHODS cleanup_finalize  REDEFINITION.
ENDCLASS.

CLASS lsc_zi_matmass_stawn IMPLEMENTATION.

  METHOD finalize.
  ENDMETHOD.

  METHOD check_before_save.
  ENDMETHOD.

  METHOD save.
    " the API saves and commits itself (BOPF): planned as tRFC, executed after the commit of this LUW
    IF lcl_buffer=>lines IS NOT INITIAL.
      CALL FUNCTION '/SAPSLL/API_COMCO_CLS_DISTR' IN BACKGROUND TASK
        EXPORTING
          it_comco_cls_distr = lcl_buffer=>lines.
    ENDIF.
  ENDMETHOD.

  METHOD cleanup.
    lcl_buffer=>clear( ).
  ENDMETHOD.

  METHOD cleanup_finalize.
    lcl_buffer=>clear( ).
  ENDMETHOD.

ENDCLASS.
