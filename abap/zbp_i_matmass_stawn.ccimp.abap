*"* Behavior pool ZBP_I_MATMASS_STAWN, tab "Local Types" (replace the generated content with this file).
*"*
*"* Static action setCode( Material, Plant, Code ) writes the commodity code MARC-STAWN of one material/plant.
*"* The app calls it once per material/plant, one change set each in a $batch; RAP saves and commits per change set.
*"* A rejected item comes back with MessageType 'E' and the reason in Message (no FAILED), so the result reaches the app.
*"*
*"* MARC-STAWN is written directly (UPDATE in the save phase, lock EMMARCE taken in the action): on DS4 (8 Oct 2026)
*"* neither API_PRODUCT_SRV (property Commodity, HTTP 204, value not saved) nor BAPI_MATERIAL_SAVEDATA
*"* (PLANTDATA-COMM_CODE, M3 810 "No changes made") updates the field. No change document is written; the checks of
*"* MM02 do not run. Checked here: M_MATE_WRK activity 02 for the plant, M_MATE_MAT activity 02 if the material has an
*"* authorization group, material and plant exist, code = digits and spaces, max. 17. CSRF and S_SERVICE: Gateway.

"! Changes collected in the interaction phase, written in the save phase.
CLASS lcl_buffer DEFINITION FINAL.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_change,
             matnr TYPE matnr,
             werks TYPE werks_d,
             stawn TYPE stawn,
           END OF ty_change,
           tt_change TYPE SORTED TABLE OF ty_change WITH UNIQUE KEY matnr werks.
    CLASS-DATA changes TYPE tt_change.
    CLASS-METHODS add IMPORTING is_change TYPE ty_change.
ENDCLASS.

CLASS lcl_buffer IMPLEMENTATION.
  METHOD add.
    INSERT is_change INTO TABLE changes.
    IF sy-subrc <> 0.
      MODIFY TABLE changes FROM is_change.
    ENDIF.
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
    " not used by the static action (it locks in PROCESS); here for instance access via EML
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
        APPEND VALUE #( %tky = ls_key-%tky ) TO failed-stawn.
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
    DATA lv_new   TYPE stawn.
    DATA lv_begru TYPE begru.

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

    " format: digits and spaces, max. 17 characters (data element STAWN); "" clears the code
    lv_new = condense( is_in-code ).
    IF NOT lv_new CO '0123456789 '.
      rs_out-message = |Commodity code "{ is_in-code }": digits and spaces only, max. 17 characters|.
      RETURN.
    ENDIF.
    rs_out-code = lv_new.

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

    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @is_in-plant
      INTO @rs_out-previous.
    IF sy-subrc <> 0.
      rs_out-message = |Material { is_in-material } is not maintained in plant { is_in-plant }|.
      RETURN.
    ENDIF.
    IF lv_new = rs_out-previous.
      rs_out-messagetype = 'S'.
      rs_out-message     = 'unchanged'.
      RETURN.
    ENDIF.

    " same lock as the material master transaction uses for plant data; released with the commit of the change set
    CALL FUNCTION 'ENQUEUE_EMMARCE'
      EXPORTING
        matnr          = lv_matnr
        werks          = is_in-plant
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.
    IF sy-subrc <> 0.
      rs_out-message = COND #( WHEN sy-subrc = 1 THEN |Material { is_in-material } plant { is_in-plant } is locked by { sy-msgv1 }|
                               ELSE |Material { is_in-material } plant { is_in-plant }: lock failed| ).
      RETURN.
    ENDIF.

    lcl_buffer=>add( VALUE #( matnr = lv_matnr werks = is_in-plant stawn = lv_new ) ).
    rs_out-changed     = abap_true.
    rs_out-messagetype = 'S'.
    rs_out-message     = 'Commodity code changed (MARC-STAWN)'.
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
    " direct update of MARC-STAWN (see header); the RAP framework commits afterwards
    LOOP AT lcl_buffer=>changes INTO DATA(ls_change).
      UPDATE marc SET stawn = @ls_change-stawn
        WHERE matnr = @ls_change-matnr AND werks = @ls_change-werks.
    ENDLOOP.
  ENDMETHOD.

  METHOD cleanup.
    CLEAR lcl_buffer=>changes.
  ENDMETHOD.

  METHOD cleanup_finalize.
    CLEAR lcl_buffer=>changes.
  ENDMETHOD.

ENDCLASS.
