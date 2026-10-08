# RAP service ZMM_MATMASS_STAWN_O2 (commodity code), all in ADT

In S/4HANA the field "MARC-STAWN" is not read from MARC: every read of MARC goes through proxy view `NSDM_V_MARC`
(CDS `NSDM_E_MARC`), which returns `/SAPSLL/MARITC-CCNGN` for the numbering scheme of the plant's country
(`/SAPSLL/TUNOS`, CTSTY '01'), valid today (note 3026397). Writing MARC (API_PRODUCT_SRV, BAPI, a direct UPDATE) has
no visible effect (DS4 test 8 Oct 2026). This service therefore maintains the trade classification in
`/SAPSLL/MARITC` through SAP's API `/SAPSLL/API_COMCO_CLS_DISTR` (note 2458080), one code per material and scheme:
the current classification ends yesterday, the new code is valid from today to 31.12.9999. No SEGW, no ICF node.

## 1. Objects (ADT, DS4 client 400, package ZMM_MATMASS, transport DS4K915674)

Create in this order (right-click package `ZMM_MATMASS` → *New → Other ABAP Repository Object*), paste the file,
activate:

| # | ADT object type | Name | File |
|---|---|---|---|
| 1 | Core Data Services → Data Definition (template *Define Root View Entity*) | `ZI_MATMASS_STAWN` | `zi_matmass_stawn.ddls.asddls` |
| 2 | Core Data Services → Access Control | `ZI_MATMASS_STAWN` | `zi_matmass_stawn.dcls.asdcls` |
| 3 | Core Data Services → Data Definition (template *Define Abstract Entity*) | `ZA_MATMASS_STAWN_P` | `za_matmass_stawn_p.ddls.asddls` |
| 4 | Core Data Services → Data Definition (template *Define Abstract Entity*) | `ZA_MATMASS_STAWN_R` | `za_matmass_stawn_r.ddls.asddls` |
| 5 | Core Data Services → Behavior Definition (on `ZI_MATMASS_STAWN`, implementation type *Unmanaged*) | `ZI_MATMASS_STAWN` | `zi_matmass_stawn.bdef.asbdef` |
| 5a | Behavior pool: in the BDEF put the cursor on `zbp_i_matmass_stawn`, Ctrl+1 → *Create behavior implementation class*; tab *Local Types*: replace all with the file | `ZBP_I_MATMASS_STAWN` | `zbp_i_matmass_stawn.ccimp.abap` (global part: `zbp_i_matmass_stawn.clas.abap`, as generated) |
| 6 | Business Services → Service Definition | `ZMM_MATMASS_STAWN` | `zmm_matmass_stawn.srvd.srvdsrv` |
| 7 | Business Services → Service Binding, binding type *OData V2 - Web API*, service definition `ZMM_MATMASS_STAWN` | `ZMM_MATMASS_STAWN_O2` | – |

Activate the BDEF and the class together (Ctrl+Shift+F3) if the BDEF complains about the missing class.
Service binding: *Activate*, then *Publish* (local service endpoint). That registers the service in Gateway; no
`/IWFND/MAINT_SERVICE` step. Path: `/sap/opu/odata/sap/ZMM_MATMASS_STAWN_O2/` (default in the app, section
Connection, field *Commodity code service*). The publish is per system: repeat it in the target system after transport.

## 2. Authorization

Role of the users: `S_SERVICE` for `ZMM_MATMASS_STAWN_O2` (PFCG → menu → Authorization Default → TADIR service
`R3TR IWSG ZMM_MATMASS_STAWN_O2_0001`), plus `M_MATE_WRK` activity 02 for the plants and `M_MATE_MAT` activity 02 for
the authorization groups of the materials (reading the entity needs `M_MATE_WRK` activity 03, access control).
The API itself is called in a background call; the checks are the ones of the action — keep the role limited to the
migration team.

## 3. Interface (what the app sends)

One `$batch` per package, one change set per material/plant calling the static action (OData V2 function import):

```
POST setCode?Material='1080626'&Plant='AF00'&Code='84099900'          (Code='' clears the code)
200  { "d": { "setCode": { "Material": "1080626", "Plant": "AF00", "Code": "84099900", "Previous": "741521 00",
                          "Changed": true, "MessageType": "S", "Message": "Commodity code changed (MARC-STAWN)" } } }
```

A rejected item comes back with `MessageType` `E` and the reason in `Message`; the other items continue. The app
reads the function import name from `$metadata` (the one ending in `setCode`) and sends the plants of one material in
one change set. The API runs as tRFC after the commit: check `/SAPSLL/MARITC` (or SE16N `MARC`, which shows it) and
SM58 for failed calls.

## 4. Test in the Gateway Client (/IWFND/GW_CLIENT, client 410)

```
GET  /sap/opu/odata/sap/ZMM_MATMASS_STAWN_O2/$metadata                    → FunctionImport Name="setCode"
POST /sap/opu/odata/sap/ZMM_MATMASS_STAWN_O2/setCode?Material='1080626'&Plant='AF00'&Code='84099900'
```

Expected 200 with `Changed: true`; a moment later SE16N `/SAPSLL/MARITC` (MATNR 000000000005000000) shows the old
record ending yesterday and the new code from today, and SE16N `MARC` shows the new code. ADT alternative: in the service binding,
select entity `Stawn` → *Preview* (read only).

## 5. Clean-up

Delete the earlier ICF handler class `ZCL_MM_MATMASS_STAWN` in ADT (no ICF node, no SEGW project needed).
