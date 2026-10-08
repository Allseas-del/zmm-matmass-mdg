sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/core/HTML"
], function (UIComponent, HTML) {
  "use strict";
  // Hosts the self-contained upload tool (tool.html) inside the Fiori launchpad.
  // The iframe is served from the same BSP, so all OData calls are same-origin and use the FLP session.
  return UIComponent.extend("com.allseas.zmmmatmassmdg.Component", {
    metadata: { manifest: "json" },
    createContent: function () {
      // tool.html is not part of the UI5 cache buster: without a changing query the browser (and the ICM cache)
      // keep serving the previous version after a deploy (DS4, 7 Oct 2026). The timestamp forces a fresh copy.
      var sUrl = sap.ui.require.toUrl("com/allseas/zmmmatmassmdg/tool.html") + "?_=" + Date.now();
      return new HTML({
        content: '<iframe src="' + sUrl + '" style="border:0;width:100%;height:100%;display:block" title="Material master mass upload"></iframe>',
        preferDOM: true
      });
    }
  });
});
