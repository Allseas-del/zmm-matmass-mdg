# zmm-matmass – Material master mass upload (Allseas DS4)

Loads the SAP Migration Cockpit (LTMC) product template (XML Spreadsheet 2003) into S/4HANA through the released OData V4 Product API.
Same engine as the STIHL task list upload (parser, $metadata validation, $batch with continue-on-error, parallel workers, results CSV and resume),
hosted as BSP `ZMM_MATMASS_MDG` in the Fiori launchpad instead of the console loader.

- Package `ZMM_MATMASS`, transport `DS4K915674`, build in DS4/400, test in DS4/410
- Design: `docs/design.html`
- Deploy: `npm install` then `npm run deploy`
