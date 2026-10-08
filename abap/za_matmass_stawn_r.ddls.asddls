// 4/7  Data Definition (abstract entity) ZA_MATMASS_STAWN_R
// Result of the action setCode: MessageType 'S' (changed or unchanged) or 'E' (rejected, reason in Message).
@EndUserText.label: 'Mass upload: commodity code - result'
define abstract entity ZA_MATMASS_STAWN_R
{
  Material    : abap.char(40);
  Plant       : abap.char(4);
  Code        : abap.char(17);
  Previous    : abap.char(17);
  Changed     : abap_boolean;
  MessageType : abap.char(1);
  Message     : abap.char(220);
}
