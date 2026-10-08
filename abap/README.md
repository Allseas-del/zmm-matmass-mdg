# Gateway service ZMM_MATMASS_STAWN_SRV (commodity code MARC-STAWN)

The released Product APIs do not write the commodity code: on DS4 (8 Oct 2026) `API_PRODUCT_2` (V4) has no such
property, `API_PRODUCT_SRV` (V2, `A_ProductPlant-Commodity`) answers 204 but does not save it, and
`BAPI_MATERIAL_SAVEDATA` (`PLANTDATA-COMM_CODE`) reports "No changes made". The app therefore writes the column
`STAWN` of the Plant Data sheet through this small SEGW service, which updates `MARC-STAWN` directly.
In S/4HANA International Trade the commodity code itself is kept in `/SAPSLL/MARITC` (KBA 2432527); this service
only maintains the MARC field (decision 8 Oct 2026).

## 1. SEGW (DS4 client 400, package ZMM_MATMASS, transport DS4K915674)

1. SEGW → *Create Project*: `ZMM_MATMASS_STAWN`, description *Mass upload: commodity code MARC-STAWN*,
   type *Service with SAP Annotations*, package `ZMM_MATMASS`.
2. *Data Model → Entity Types → Create*: entity type `Stawn`, tick *Create related Entity Set* (name `StawnSet`).
3. Properties of `Stawn` (ABAP field names exactly as below, the method uses them):

   | Property | Key | Edm type | Max length | ABAP field name |
   |---|---|---|---|---|
   | `Material` | x | Edm.String | 40 | `MATERIAL` |
   | `Plant` | x | Edm.String | 4 | `PLANT` |
   | `Code` | | Edm.String | 17 | `CODE` |
   | `Previous` | | Edm.String | 17 | `PREVIOUS` |
   | `Changed` | | Edm.Boolean | | `CHANGED` |
   | `Type` | | Edm.String | 1 | `TYPE` |
   | `Message` | | Edm.String | 220 | `MESSAGE` |

4. Entity set `StawnSet`: *Creatable* on (the others may stay off).
5. *Generate Runtime Objects* with the default names: `ZCL_ZMM_MATMASS_STAWN_MPC(_EXT)`,
   `ZCL_ZMM_MATMASS_STAWN_DPC(_EXT)`, model `ZMM_MATMASS_STAWN_MDL`, service `ZMM_MATMASS_STAWN_SRV`.
6. ADT: open `ZCL_ZMM_MATMASS_STAWN_DPC_EXT`, redefine method `STAWNSET_CREATE_ENTITY` and paste the body from
   `zcl_zmm_matmass_stawn_dpc_ext.stawnset_create_entity.abap` (the `METHOD … ENDMETHOD.` block). Activate.

## 2. Register the service

`/IWFND/MAINT_SERVICE` → *Add Service*, system alias `LOCAL`, technical service name `ZMM_MATMASS_STAWN_SRV`,
package `ZMM_MATMASS`. The service path becomes `/sap/opu/odata/sap/ZMM_MATMASS_STAWN_SRV/` (the default in the app,
section Connection, field *Commodity code service*).

## 3. Authorization

Role of the users: `S_SERVICE` for `ZMM_MATMASS_STAWN_SRV` (PFCG → menu → Authorization Default → TADIR service
`R3TR IWSG ZMM_MATMASS_STAWN_SRV_0001`), plus `M_MATE_WRK` activity 02 for the plants and `M_MATE_MAT` activity 02 for
the authorization groups of the materials. The method writes MARC directly: no change document, no MM02 checks —
keep the role limited to the migration team.

## 4. Interface (what the app sends)

One `$batch` per package, one change set per material/plant:

```
POST StawnSet   { "Material": "5000000", "Plant": "AF00", "Code": "84099900" }      ("" clears the code)
201             { "d": { ..., "Previous": "741521 00", "Changed": true, "Type": "S", "Message": "Commodity code changed (MARC-STAWN)" } }
```

A rejected item comes back with `Type` `E` and the reason in `Message`; the other items continue.

## 5. Test in the Gateway Client (/IWFND/GW_CLIENT, client 410)

```
POST /sap/opu/odata/sap/ZMM_MATMASS_STAWN_SRV/StawnSet
Content-Type: application/json
{ "Material": "5000000", "Plant": "AF00", "Code": "84099900" }
```

Expected 201 with `Changed: true`; then SE16N `MARC` (MATNR 5000000, WERKS AF00) shows `84099900`.

## 6. Clean-up

The earlier ICF handler class `ZCL_MM_MATMASS_STAWN` is not used any more: delete it in ADT (no ICF node was created).
