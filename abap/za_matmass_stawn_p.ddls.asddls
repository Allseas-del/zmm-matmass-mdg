// 3/7  Data Definition (abstract entity) ZA_MATMASS_STAWN_P
// Parameter of the action setCode. Material as entered (external format, e.g. 1080626); Code "" clears it.
@EndUserText.label: 'Mass upload: commodity code - input'
define abstract entity ZA_MATMASS_STAWN_P
{
  Material : abap.char(40);
  Plant    : abap.char(4);
  Code     : abap.char(17);
}
