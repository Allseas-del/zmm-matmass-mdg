# RAP service ZMM_MATMASS_STAWN_O2 (commodity code MARC-STAWN), all in ADT

The released Product APIs do not write the commodity code: on DS4 (8 Oct 2026) `API_PRODUCT_2` (V4) has no such
property, `API_PRODUCT_SRV` (V2, `A_ProductPlant-Commodity`) answers 204 but does not save it, and
`BAPI_MATERIAL_SAVEDATA` (`PLANTDATA-COMM_CODE`) reports "No changes made". The app therefore writes the column
`STAWN` of the Plant Data sheet through this small RAP service, which updates `MARC-STAWN` directly.
In S/4HANA International Trade the commodity code itself is kept in `/SAPSLL/MARITC` (KBA 2432527); this service
only maintains the MARC field (decision 8 Oct 2026). No SEGW project, no custom ICF node.

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
The service writes MARC directly: no change document, no MM02 checks — keep the role limited to the migration team.

## 3. Interface (what the app sends)

One `$batch` per package, one change set per material/plant calling the static action (OData V2 function import):

```
POST setCode?Material='1080626'&Plant='AF00'&Code='84099900'          (Code='' clears the code)
200  { "d": { "setCode": { "Material": "1080626", "Plant": "AF00", "Code": "84099900", "Previous": "741521 00",
                          "Changed": true, "MessageType": "S", "Message": "Commodity code changed (MARC-STAWN)" } } }
```

A rejected item comes back with `MessageType` `E` and the reason in `Message`; the other items continue. The app
reads the function import name from `$metadata` (the one ending in `setCode`).

## 4. Test in the Gateway Client (/IWFND/GW_CLIENT, client 410)

```
GET  /sap/opu/odata/sap/ZMM_MATMASS_STAWN_O2/$metadata                    → FunctionImport Name="setCode"
POST /sap/opu/odata/sap/ZMM_MATMASS_STAWN_O2/setCode?Material='1080626'&Plant='AF00'&Code='84099900'
```

Expected 200 with `Changed: true`; then SE16N `MARC` shows `84099900`. ADT alternative: in the service binding,
select entity `Stawn` → *Preview* (read only).

## 5. Clean-up

Delete the earlier ICF handler class `ZCL_MM_MATMASS_STAWN` in ADT (no ICF node, no SEGW project needed).
