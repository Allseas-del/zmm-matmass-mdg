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
"! Each item is saved with BAPI_MATERIAL_SAVEDATA (PLANTDATA-COMM_CODE) and committed on its own, so one rejected
"! item does not stop the others. After the commit MARC is read again: "changed" reports what is really in the
"! database, in case the BAPI accepts the field but does not update it in this S/4HANA release (SAP note 2267246,
"! foreign trade fields in the material master).
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

    " Coarse check up front; the BAPI checks the material master authorizations (M_MATE_WRK, M_MATE_MAT, ...) per item.
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
    DATA lv_matnr  TYPE matnr.
    DATA lv_new    TYPE stawn.
    DATA lv_after  TYPE stawn.
    DATA ls_head   TYPE bapimathead.
    DATA ls_plant  TYPE bapi_marc.
    DATA ls_plantx TYPE bapi_marcx.
    DATA ls_return TYPE bapiret2.
    DATA lt_msgs   TYPE STANDARD TABLE OF bapi_matreturn2.

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

    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @cs_item-plant
      INTO @cs_item-previous.
    IF sy-subrc <> 0.
      cs_item-type    = 'E'.
      cs_item-message = |Material { cs_item-material } is not maintained in plant { cs_item-plant }|.
      RETURN.
    ENDIF.

    lv_new = condense( cs_item-commodity_code ).
    cs_item-commodity_code = lv_new.
    IF lv_new = cs_item-previous.
      cs_item-type    = 'S'.
      cs_item-message = 'unchanged'.
      RETURN.
    ENDIF.

    ls_head-material      = lv_matnr.
    ls_head-material_long = lv_matnr.
    ls_plant-plant        = cs_item-plant.
    ls_plant-comm_code    = lv_new.
    ls_plantx-plant       = cs_item-plant.
    ls_plantx-comm_code   = abap_true.

    CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'
      EXPORTING
        headdata       = ls_head
        plantdata      = ls_plant
        plantdatax     = ls_plantx
      IMPORTING
        return         = ls_return
      TABLES
        returnmessages = lt_msgs.

    IF ls_return-type CA 'EAX'.
      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
      cs_item-type    = 'E'.
      cs_item-message = ls_return-message.
      LOOP AT lt_msgs INTO DATA(ls_msg) WHERE type CA 'EAX' AND message <> ls_return-message.
        cs_item-message = |{ cs_item-message } \| { ls_msg-message }|.
      ENDLOOP.
      RETURN.
    ENDIF.

    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = abap_true.

    " what is in the database now: the BAPI may accept the field without updating it (SAP note 2267246)
    SELECT SINGLE stawn FROM marc
      WHERE matnr = @lv_matnr AND werks = @cs_item-plant
      INTO @lv_after.
    IF lv_after = lv_new.
      cs_item-changed = abap_true.
      cs_item-type    = 'S'.
      cs_item-message = COND #( WHEN ls_return-message IS INITIAL THEN 'Material changed' ELSE ls_return-message ).
    ELSE.
      cs_item-type    = 'E'.
      cs_item-message = |BAPI_MATERIAL_SAVEDATA returned no error but MARC-STAWN is still "{ lv_after }": field not updated through the BAPI in this release (SAP note 2267246)|.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
