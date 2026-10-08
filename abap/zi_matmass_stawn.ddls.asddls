// 1/7  Data Definition (CDS view entity) ZI_MATMASS_STAWN
// Root entity of the commodity code service: one row per material/plant (MARC).
// Read-only; the change goes through the static action setCode (behavior definition ZI_MATMASS_STAWN).
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Mass upload: commodity code per plant'
define root view entity ZI_MATMASS_STAWN
  as select from marc
{
  key matnr as Material,
  key werks as Plant,
      stawn as CommodityCode
}
