"! Custom HTTP service for the mass upload app (BSP ZMM_MATMASS_MDG): writes the commodity code MARC-STAWN per
"! material and plant. The released Product APIs (API_PRODUCT_2 V4, API_PRODUCT_SRV V2) do not carry this field
"! (checked on DS4 $metadata, 8 Oct 2026), so the app sends the STAWN column of the Plant Data sheet here.
"!
"! ICF node: /sap/bc/zmm_matmass/stawn (SICF, handler list = this class). See README.md next to this file.
"!
"! CSRF   GET with header "X-CSRF-Token: Fetch" returns the token; the POST must send it (403 + "X-CSRF-Token: Required"
"!        otherwise) and Content-Type application/json (415 otherwise).
"!
"! Request  POST, application/json
"!   { "items": [ { "material": "5000000", "plant": "AF00", "commodityCode": "84099900" }, ... ] }
"!   commodityCode "" clears the code.
"! Response 200, application/json, one entry per request item in the same order
"!   { "items": [ { "material", "plant", "commodityCode", "previous", "changed", "type": "S"|"E", "message" } ] }
"!
"! Each item is written directly to MARC-STAWN (UPDATE with lock EMMARCE) and committed on its own, so one rejected
"! item does not stop the others. Reason: on DS4 (8 Oct 2026) neither API_PRODUCT_SRV (PATCH A_ProductPlant, property
"! Commodity: HTTP 204, value not saved) nor BAPI_MATERIAL_SAVEDATA (PLANTDATA-COMM_CODE: M3 810 "No changes made")
"! updates the field. In S/4HANA International Trade the commodity code lives in /SAPSLL/MARITC (KBA 2432527); this
"! service only maintains the old MARC field, on request of the business (decision 8 Oct 2026).
"! Consequences: no change document is written, and the checks of the material master transaction do not run.
"! The handler itself checks M_MATE_WRK (activity 02, plant of the item) and M_MATE_MAT (authorization group of the
"! material, if set), that material and plant exist, and the format of the code (digits and spaces, max. 17).
CLASS zcl_mm_matmass_stawn DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_http_extension.

  PRIVATE SECTION.
    TYPES:
      BEGIN OF ty_item,
        material      TYPE string,
        plant         TYPE werks_d,
        commodity_code TYPE string,
        previous      TYPE stawn,
        changed       TYPE abap_bool,
        type          TYPE bapi_mtype,
        message       TYPE string,
      END OF ty_item,
      ty_items TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY,
      BEGIN OF ty_request,
        items TYPE ty_items,
      END OF ty_request,
      BEGIN OF ty_response,
        items TYPE ty_items,
      END OF ty_response.

    METHODS save_one
      CHANGING
        cs_item TYPE ty_item.

    METHODS reply
      IMPORTING
        io_server TYPE REF TO if_http_server
        iv_status TYPE i
        iv_json   TYPE string.
ENDCLASS.


CLASS zcl_mm_matmass_stawn IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA ls_request  TYPE ty_request.
    DATA ls_response TYPE ty_response.

    DATA lv_token TYPE string.
    DATA lv_valid TYPE abap_bool.

    " CSRF protection. The node runs with the launchpad session (cookies), so without a token any other web page
    " opened in the same browser could post here with the user's rights. Same pattern as SAP Gateway:
    " 1) GET with header "X-CSRF-Token: Fetch" returns the token in the response header,
    " 2) POST must carry that token and Content-Type application/json (a cross-site HTML form cannot send JSON).
    " Methods IF_HTTP_SERVER~GET_XSRF_TOKEN / VALIDATE_XSRF_TOKEN: check the exact signature in SE24 on DS4.
    IF server->request->get_method( ) = 'GET'
       AND to_upper( server->request->get_header_field( 'x-csrf-token' ) ) = 'FETCH'.
      server->get_xsrf_token( IMPORTING token = lv_token ).
      server->response->set_header_field( name = 'x-csrf-token' value = lv_token ).
      reply( io_server = server iv_status = 200 iv_json = '{}' ).
      RETURN.
    ENDIF.

    IF server->request->get_method( ) <> 'POST'.
      reply( io_server = server iv_status = 405 iv_json = '{"message":"POST only"}' ).
      RETURN.
    ENDIF.

    IF to_lower( server->request->get_header_field( 'content-type' ) ) NS 'application/json'.
      reply( io_server = server iv_status = 415 iv_json = '{"message":"Content-Type application/json required"}' ).
      RETURN.
    ENDIF.

    server->validate_xsrf_token( IMPORTING successful = lv_valid ).
    IF lv_valid <> abap_true.
      server->response->set_header_field( name = 'x-csrf-token' value = 'Required' ).
      reply( io_server = server iv_status = 403 iv_json = '{"message":"CSRF token validation failed"}' ).
      RETURN.
    ENDIF.

    " Coarse check up front (any plant); the exact check per plant follows in save_one.
    AUTHORITY-CHECK OBJECT 'M_MATE_WRK'
      ID 'ACTVT' FIELD '02'
      ID 'WERKS' DUMMY.
    IF sy-subrc <> 0.
      reply( io_server = server iv_status = 403 iv_json = '{"message":"No authorization to change plant data of materials (M_MATE_WRK)"}' ).
      RETURN.
    ENDIF.

    TRY.
        /ui2/cl_json=>deserialize(
          EXPORTING
            json        = server->request->get_cdata( )
            pretty_name = /ui2/cl_json=>pretty_mode-camel_case
          CHANGING
            data        = ls_request ).
      CATCH cx_root INTO DATA(lx_json).
        reply( io_server = server iv_status = 400 iv_json = |\{"message":"Invalid JSON: { escape( val = lx_json->get_text( ) format = cl_abap_format=>e_json_string ) }"\}| ).
        RETURN.
    ENDTRY.

    LOOP AT ls_request-items ASSIGNING FIELD-SYMBOL(<ls_item>).
      save_one( CHANGING cs_item = <ls_item> ).
    ENDLOOP.

    ls_response-items = ls_request-items.
    reply( io_server = server
           iv_status = 200
           iv_json   = /ui2/cl_json=>serialize( data        = ls_response
                                                compress    = abap_false
                                                pretty_name = /ui2/cl_json=>pretty_mode-camel_case ) ).
  ENDMETHOD.


  METHOD reply.
    io_server->response->set_status( code = iv_status reason = 'OK' ).
    io_server->response->set_content_type( 'application/json; charset=utf-8' ).
    io_server->response->set_cdata( iv_json ).
  ENDMETHOD.


  METHOD save_one.
    DATA lv_matnr TYPE matnr.
    DATA lv_new   TYPE stawn.
    DATA lv_after TYPE stawn.
    DATA lv_begru TYPE begru.

    cs_item-changed = abap_false.

    " material number as entered (5000000) -> internal format (leading zeros)
    CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
      EXPORTING
        input        = cs_item-material
      IMPORTING
        output       = lv_matnr
      EXCEPTIONS
        length_error = 1
        OTHERS       = 2.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = |Material { cs_item-material }: invalid material number|.
      RETURN.
    ENDIF.

    " format: digits and spaces, max. 17 characters (data element STAWN); "" clears the code
    lv_new = condense( cs_item-commodity_code ).
    IF strlen( condense( cs_item-commodity_code ) ) > 17 OR NOT lv_new CO '0123456789 '.
      cs_item-type    = 'E'.
      cs_item-message = |Commodity code "{ cs_item-commodity_code }": digits and spaces only, max. 17 characters|.
      RETURN.
    ENDIF.
    cs_item-commodity_code = lv_new.

    " authorization per plant and, if the material has one, per authorization group
    AUTHORITY-CHECK OBJECT 'M_MATE_WRK'
      ID 'ACTVT' FIELD '02'
      ID 'WERKS' FIELD cs_item-plant.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = |No authorization to change material data in plant { cs_item-plant } (M_MATE_WRK)|.
      RETURN.
    ENDIF.
    SELECT SINGLE begru FROM mara WHERE matnr = @lv_matnr INTO @lv_begru.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = |Material { cs_item-material } does not exist|.
      RETURN.
    ENDIF.
    IF lv_begru IS NOT INITIAL.
      AUTHORITY-CHECK OBJECT 'M_MATE_MAT'
        ID 'ACTVT' FIELD '02'
        ID 'BEGRU' FIELD lv_begru.
      IF sy-subrc <> 0.
        cs_item-type    = 'E'.
        cs_item-message = |No authorization for authorization group { lv_begru } of material { cs_item-material } (M_MATE_MAT)|.
        RETURN.
      ENDIF.
    ENDIF.

    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @cs_item-plant
      INTO @cs_item-previous.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = |Material { cs_item-material } is not maintained in plant { cs_item-plant }|.
      RETURN.
    ENDIF.
    IF lv_new = cs_item-previous.
      cs_item-type    = 'S'.
      cs_item-message = 'unchanged'.
      RETURN.
    ENDIF.

    " same lock as the material master transaction uses for plant data
    CALL FUNCTION 'ENQUEUE_EMMARCE'
      EXPORTING
        matnr          = lv_matnr
        werks          = cs_item-plant
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = COND #( WHEN sy-subrc = 1 THEN |Material { cs_item-material } plant { cs_item-plant } is locked by { sy-msgv1 }|
                                ELSE |Material { cs_item-material } plant { cs_item-plant }: lock failed| ).
      RETURN.
    ENDIF.

    UPDATE marc SET stawn = @lv_new
      WHERE matnr = @lv_matnr AND werks = @cs_item-plant.
    IF sy-subrc <> 0.
      ROLLBACK WORK.
      cs_item-type    = 'E'.
      cs_item-message = |Material { cs_item-material } plant { cs_item-plant }: update of MARC failed|.
    ELSE.
      COMMIT WORK AND WAIT.
      SELECT SINGLE stawn FROM marc
        WHERE matnr = @lv_matnr AND werks = @cs_item-plant
        INTO @lv_after.
      cs_item-changed = xsdbool( lv_after = lv_new ).
      cs_item-type    = COND #( WHEN cs_item-changed = abap_true THEN 'S' ELSE 'E' ).
      cs_item-message = COND #( WHEN cs_item-changed = abap_true THEN 'Commodity code changed (MARC-STAWN)'
                                ELSE |MARC-STAWN is "{ lv_after }" after the update| ).
    ENDIF.

    CALL FUNCTION 'DEQUEUE_EMMARCE'
      EXPORTING
        matnr = lv_matnr
        werks = cs_item-plant.
  ENDMETHOD.

ENDCLASS.
