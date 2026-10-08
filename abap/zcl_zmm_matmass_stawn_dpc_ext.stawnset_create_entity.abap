  "! Redefinition in ZCL_ZMM_MATMASS_STAWN_DPC_EXT (SEGW project ZMM_MATMASS_STAWN, entity set StawnSet).
  "! POST StawnSet { Material, Plant, Code } writes the commodity code MARC-STAWN of one material/plant and answers
  "! 201 with the same entity: Previous (value before), Changed, Type 'S'|'E', Message. A rejected item comes back
  "! with Type 'E' (no exception), so the other change sets of the app's $batch continue.
  "!
  "! MARC-STAWN is written directly (UPDATE under lock EMMARCE): on DS4 (8 Oct 2026) neither API_PRODUCT_SRV
  "! (property Commodity, HTTP 204, value not saved) nor BAPI_MATERIAL_SAVEDATA (PLANTDATA-COMM_CODE, M3 810
  "! "No changes made") updates the field. No change document is written; the checks of MM02 do not run. Checked
  "! here: M_MATE_WRK activity 02 for the plant, M_MATE_MAT activity 02 if the material has an authorization group,
  "! material and plant exist, code = digits and spaces, max. 17. Gateway commits at the end of the request and
  "! releases the lock (scope 2); CSRF and S_SERVICE are handled by Gateway.
  METHOD stawnset_create_entity.
    DATA ls_in    TYPE zcl_zmm_matmass_stawn_mpc=>ts_stawn.
    DATA lv_matnr TYPE matnr.
    DATA lv_new   TYPE stawn.
    DATA lv_after TYPE stawn.
    DATA lv_begru TYPE begru.

    io_data_provider->read_entry_data( IMPORTING es_data = ls_in ).
    er_entity = ls_in.
    er_entity-changed = abap_false.
    er_entity-type    = 'E'.

    " material number as entered (5000000) -> internal format (leading zeros)
    CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
      EXPORTING
        input        = ls_in-material
      IMPORTING
        output       = lv_matnr
      EXCEPTIONS
        length_error = 1
        OTHERS       = 2.
    IF sy-subrc <> 0.
      er_entity-message = |Material { ls_in-material }: invalid material number|.
      RETURN.
    ENDIF.

    " format: digits and spaces, max. 17 characters (data element STAWN); "" clears the code
    lv_new = condense( ls_in-code ).
    IF NOT lv_new CO '0123456789 '.
      er_entity-message = |Commodity code "{ ls_in-code }": digits and spaces only, max. 17 characters|.
      RETURN.
    ENDIF.
    er_entity-code = lv_new.

    " authorization per plant and, if the material has one, per authorization group
    AUTHORITY-CHECK OBJECT 'M_MATE_WRK'
      ID 'ACTVT' FIELD '02'
      ID 'WERKS' FIELD ls_in-plant.
    IF sy-subrc <> 0.
      er_entity-message = |No authorization to change material data in plant { ls_in-plant } (M_MATE_WRK)|.
      RETURN.
    ENDIF.
    SELECT SINGLE begru FROM mara WHERE matnr = @lv_matnr INTO @lv_begru.
    IF sy-subrc <> 0.
      er_entity-message = |Material { ls_in-material } does not exist|.
      RETURN.
    ENDIF.
    IF lv_begru IS NOT INITIAL.
      AUTHORITY-CHECK OBJECT 'M_MATE_MAT'
        ID 'ACTVT' FIELD '02'
        ID 'BEGRU' FIELD lv_begru.
      IF sy-subrc <> 0.
        er_entity-message = |No authorization for authorization group { lv_begru } of material { ls_in-material } (M_MATE_MAT)|.
        RETURN.
      ENDIF.
    ENDIF.

    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @ls_in-plant
      INTO @er_entity-previous.
    IF sy-subrc <> 0.
      er_entity-message = |Material { ls_in-material } is not maintained in plant { ls_in-plant }|.
      RETURN.
    ENDIF.
    IF lv_new = er_entity-previous.
      er_entity-type    = 'S'.
      er_entity-message = 'unchanged'.
      RETURN.
    ENDIF.

    " same lock as the material master transaction uses for plant data; released by Gateway's commit (scope 2)
    CALL FUNCTION 'ENQUEUE_EMMARCE'
      EXPORTING
        matnr          = lv_matnr
        werks          = ls_in-plant
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.
    IF sy-subrc <> 0.
      er_entity-message = COND #( WHEN sy-subrc = 1 THEN |Material { ls_in-material } plant { ls_in-plant } is locked by { sy-msgv1 }|
                                  ELSE |Material { ls_in-material } plant { ls_in-plant }: lock failed| ).
      RETURN.
    ENDIF.

    UPDATE marc SET stawn = @lv_new
      WHERE matnr = @lv_matnr AND werks = @ls_in-plant.
    IF sy-subrc <> 0.
      er_entity-message = |Material { ls_in-material } plant { ls_in-plant }: update of MARC failed|.
      RETURN.
    ENDIF.

    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @ls_in-plant
      INTO @lv_after.
    er_entity-changed = xsdbool( lv_after = lv_new ).
    er_entity-type    = COND #( WHEN er_entity-changed = abap_true THEN 'S' ELSE 'E' ).
    er_entity-message = COND #( WHEN er_entity-changed = abap_true THEN 'Commodity code changed (MARC-STAWN)'
                                ELSE |MARC-STAWN is "{ lv_after }" after the update| ).
  ENDMETHOD.
