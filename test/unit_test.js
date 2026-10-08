// End-to-end unit test of tool.html against the test double (mock.js). Run: node unit_test.js
'use strict';
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs'), path = require('path');
const BASE = 'http://localhost:8099';
const FILE = path.join(__dirname, 'test_products.xml');
const results = []; let page;
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info: info || '' }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const logText = () => page.evaluate(() => fullLog.join('\n'));
const api = async p => (await fetch(BASE + p)).json();
const waitIdle = () => page.waitForFunction(() => !document.getElementById('btnRun').disabled && document.getElementById('btnStop').disabled, null, { timeout: 30000 });
const select = async ids => page.evaluate(ids => sheets.S_MARA.rows.forEach(r => r.include = ids.includes(prodOf(r))), ids);

(async () => {
  await fetch(BASE + '/__reset');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ acceptDownloads: true });
  page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/tool.html'); await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));   // settings are in collapsed sections
  await page.uncheck('#autoDl');   // downloads are tested separately
  await page.waitForFunction(() => document.getElementById('connState').textContent !== 'testing…' && document.getElementById('connState').textContent !== 'not tested');
  ok('01 connection test runs on start-up (launchpad session), $metadata read', (await page.textContent('#connState')) === 'OK', await page.textContent('#connState'));
  ok('02 effective SAP user reported', /SAP user TESTUSER/.test(await logText()));

  await page.setInputFiles('#file', FILE);
  await page.waitForFunction(() => /File loaded/.test(fullLog.join('\n')));
  let L = await logText();
  ok('03 original SAP template (leading line break, <LS>…</> markup) is parsed', /File loaded: 3 product\(s\)/.test(L));
  ok('04 sheet without API entity reported (Class Data)', /Class Data" has 1 row\(s\): classification/.test(L));
  const tabs = await page.$$eval('#tabs button', b => b.map(x => x.textContent));
  ok('05 grid shows the sheets with data / mapped sheets', tabs.some(t => /Basic Data \(3\)/.test(t)) && tabs.some(t => /Plant \(3\)/.test(t)), tabs.slice(0, 6).join(' | '));

  await page.click('#btnDry'); await page.waitForFunction(() => /Validation against/.test(fullLog.join('\n')));
  L = await logText();
  ok('06 dry run: validation against $metadata without problems', /Validation against \$metadata: no problems/.test(L));
  const payload = await page.evaluate(() => toPayload(buildProduct(sheets.S_MARA.rows[0])));
  ok('07 payload: ISO base unit, booleans, numbers', payload.BaseISOUnit === 'PCE' && payload.ZZ1_SERNP_PRD === true && payload.GrossWeight === 0.05, JSON.stringify({ b: payload.BaseISOUnit, s: payload.ZZ1_SERNP_PRD, g: payload.GrossWeight }));
  ok('08 payload: ZZ1_MFRPN_PRD and standard MFRPN both mapped', payload.ZZ1_MFRPN_PRD === 'ABC-123' && payload.ProductManufacturerNumber === 'ABC-123');
  ok('09 payload: descriptions from Basic Data and Descriptions sheet merged (EN + NL)', (payload._ProductDescription || []).map(d => d.Language).join(',') === 'EN,NL');
  ok('10a payload: product base unit copied into valuation (unit reference of ProductPriceUnitQuantity); parent keys in children',
    payload._ProductPlant[0].Product === 'ZTEST-001' && payload._ProductPlant[0]._ProductPlantStorageLocation[0].Plant === 'NL01' && payload._ProductValuation[0].BaseISOUnit === 'PCE' && payload._ProductValuation[0].ProductPriceUnitQuantity === 1, JSON.stringify(payload._ProductValuation[0]));
  ok('10 payload: plant with MRP (1:1) and storage location (1:n), valuation, UoM with GTIN',
    payload._ProductPlant[0]._ProductPlantSupplyPlanning.MRPType === 'PD' && payload._ProductPlant[0]._ProductPlantStorageLocation[0].StorageLocation === '0001' &&
    payload._ProductValuation[0].ValuationClass === '3000' && payload._ProductUnitOfMeasure[0]._ProductUnitOfMeasureEAN[0].ConsecutiveNumber === '00001');

  // validation catches a too long description
  await page.evaluate(() => { const c = sheets.S_MARA.rows[1].cells.MAKTX; c.keep = c.value; c.value = 'X'.repeat(45); });
  await page.click('#btnDry'); await page.waitForFunction(() => /45 characters/.test(fullLog.join('\n'))).catch(() => {});
  ok('11 validation reports a description longer than 40 characters', /ProductDescription: 45 characters, max 40/.test(await logText()));
  await page.evaluate(() => { const c = sheets.S_MARA.rows[1].cells.MAKTX; c.value = c.keep; });

  // create, deep insert, split into $batch packages of 2
  await page.fill('#batchSize', '2'); const b0 = (await api('/__stats')).batch;
  await page.click('#btnRun'); await waitIdle();
  L = await logText(); let st = await api('/__stats');
  ok('12 deep create: ZTEST-001 and ZTEST-002 created', st.products.includes('ZTEST-001') && st.products.includes('ZTEST-002'), st.products.join(','));
  ok('13 split: 3 products in 2 $batch requests (+1 $batch for the valuation currencies)', st.batch - b0 === 3, 'batches=' + (st.batch - b0));
  ok('14 SAP error per product, others continue (plant ZZZZ)', /ZTEST-003: HTTP 400: Plant ZZZZ does not exist/.test(L));
  const p1 = await api('/__product?id=ZTEST-001');
  ok('15 SAP content: plant NL01 MRP type PD, storage location 0001, BOX with GTIN, 2 languages, custom fields',
    p1._ProductPlant[0]._ProductPlantSupplyPlanning.MRPType === 'PD' && p1._ProductPlant[0]._ProductPlantStorageLocation[0].WarehouseStorageBin === 'A-01-01' &&
    p1._ProductUnitOfMeasure[0].AlternativeUnit === 'BOX' && p1._ProductUnitOfMeasure[0]._ProductUnitOfMeasureEAN[0].ProductStandardID === '4006381333931' &&
    p1._ProductDescription.length === 2 && p1.ZZ1_MFRPN_PRD === 'ABC-123' && p1.ZZ1_NMOD_PRD === 'BOLT, HEX');
  const status = await page.$$eval('#grid td.st', t => t.map(x => x.textContent));
  ok('16 message column: created number / SAP return message', status[0] === 'created ZTEST-001' && /Plant ZZZZ does not exist/.test(status[2]), status.join(' | '));

  const mt = await page.evaluate(() => [document.getElementById('meterPct').textContent, document.getElementById('meterOk').style.width, document.getElementById('meterErr').style.width]);
  ok('16a progress meter: 100%, green for created, red for errors', /^100%/.test(mt[0]) && parseFloat(mt[1]) > 66 && parseFloat(mt[2]) > 33, mt.join(' | '));
  // repeat create: done products are skipped
  const postsBefore = st.post; await page.click('#btnRun'); await waitIdle(); st = await api('/__stats');
  ok('17 repeated create sends only the failed product again', st.post - postsBefore === 1, `${st.post - postsBefore} POST`);

  // change mode: two changes on ZTEST-001
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.GROES.value = 'M12X50'; sheets.S_MARC.rows[0].cells.DISMM.value = 'VB'; sheets.S_MBEW.rows[0].cells.PEINH.value = '10'; sheets.S_MBEW.rows[0].cells.VERPR.value = '1.5'; });
  await page.check('input[name=mode][value=change]'); await select(['ZTEST-001']);
  await page.click('#btnRun'); await waitIdle(); L = await logText(); st = await api('/__stats');
  const p1b = await api('/__product?id=ZTEST-001');
  ok('18 change: header field, plant MRP type, price unit and moving average price (with unit and currency reference) changed in one change set', p1b.SizeOrDimensionText === 'M12X50' && p1b._ProductPlant[0]._ProductPlantSupplyPlanning.MRPType === 'VB' && p1b._ProductValuation[0].ProductPriceUnitQuantity === 10 && p1b._ProductValuation[0].MovingAveragePrice === 1.5 && st.changesets >= 1,
    `groes=${p1b.SizeOrDimensionText} mrp=${p1b._ProductPlant[0]._ProductPlantSupplyPlanning.MRPType}`);
  ok('19 change: ETag handling — no 412 within the change set', st.preconditionFailed === 0 && /ZTEST-001 → ZTEST-001: 3 change\(s\)/.test(L));
  await page.click('#btnRun'); await waitIdle();
  ok('19a change: current state read with filtered GETs per entity set in one $batch, no $expand; PATCH only on canonical URLs',
    !st.expandGets && st.filterGets >= 5, `filterGets=${st.filterGets} expandGets=${st.expandGets || 0}`);
  // currency in the file differs from the company code currency: SAP's currency used, amount sent as it is
  await page.evaluate(() => { sheets.S_MBEW.rows[0].cells.WAERS.value = 'USD'; sheets.S_MBEW.rows[0].cells.VERPR.value = '9.99'; });
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  const p1c = await api('/__product?id=ZTEST-001');
  ok('19b valuation currency read from SAP per valuation area; file currency ignored with warning; amount sent',
    /NL01: currency USD in the file ignored, company code currency EUR used/.test(L) && p1c._ProductValuation[0].MovingAveragePrice === 9.99 && p1c._ProductValuation[0].Currency === 'EUR',
    `map=${p1c._ProductValuation[0].MovingAveragePrice} cur=${p1c._ProductValuation[0].Currency}`);
  await page.evaluate(() => { sheets.S_MBEW.rows[0].cells.WAERS.value = 'EUR'; });
  ok('20 change without differences: nothing sent', /ZTEST-001 → ZTEST-001: no differences/.test(await logText()));

  // "#" clears a field in Change mode; empty cells are left alone
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.GROES.value = '#'; sheets.S_MARA.rows[0].cells.BRGEW.value = '#'; });
  await page.click('#btnRun'); await waitIdle();
  const p1d = await api('/__product?id=ZTEST-001');
  ok('20a "#" clears fields in Change mode (text → "", decimal → 0), other fields unchanged', p1d.SizeOrDimensionText === '' && Number(p1d.GrossWeight) === 0 && p1d.ZZ1_MFRPN_PRD === 'ABC-123',
    `groes=${JSON.stringify(p1d.SizeOrDimensionText)} brgew=${p1d.GrossWeight}`);
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.GROES.value = 'M12X50'; sheets.S_MARA.rows[0].cells.BRGEW.value = '0.05'; });
  await page.click('#btnRun'); await waitIdle();
  // weight with its unit reference (DS4 8 Oct 2026: "Together with property 'GrossWeight' also property 'WeightISOUnit' needs
  // to be provided"; the mock rejects a weight without WeightISOUnit in the same PATCH)
  const refs = await page.evaluate(() => [schema.Product_Type.props.GrossWeight.ref, schema.ProductUnitOfMeasure_Type.props.GrossWeight.ref, schema.ProductValuation_Type.props.MovingAveragePrice.ref]);
  ok('20c $metadata: SAP__measures annotations (lower case alias) give the unit/currency reference of a quantity', refs.join(',') === 'WeightISOUnit,WeightISOUnit,Currency', refs.join(','));
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.BRGEW.value = '0.07'; sheets.S_MARA.rows[0].cells.NTGEW.value = '0.06'; });
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  const p1e = await api('/__product?id=ZTEST-001');
  ok('20d change: gross/net weight sent together with WeightISOUnit from the file although the unit itself is unchanged', p1e.GrossWeight === 0.07 && p1e.NetWeight === 0.06 && !/needs to be provided/.test(L), `brgew=${p1e.GrossWeight} ntgew=${p1e.NetWeight}`);
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.BRGEW.value = '0.08'; sheets.S_MARA.rows[0].cells.GEWEI.value = ''; sheets.S_MARM.rows[0].cells.BRGEW.value = '2.6'; sheets.S_MARM.rows[0].cells.GEWEI.value = ''; });
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  const p1f = await api('/__product?id=ZTEST-001');
  ok('20e change: weight without unit in the file → the unit currently in SAP is sent along (Product and unit of measure)', p1f.GrossWeight === 0.08 && p1f._ProductUnitOfMeasure[0].GrossWeight === 2.6 && !/needs to be provided/.test(L), `brgew=${p1f.GrossWeight} marm=${p1f._ProductUnitOfMeasure[0].GrossWeight}`);
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.BRGEW.value = '0.05'; sheets.S_MARA.rows[0].cells.NTGEW.value = '0.045'; sheets.S_MARA.rows[0].cells.GEWEI.value = 'KGM'; sheets.S_MARM.rows[0].cells.BRGEW.value = '2.5'; sheets.S_MARM.rows[0].cells.GEWEI.value = 'KGM'; });
  await page.click('#btnRun'); await waitIdle();
  // commodity code (MARC-STAWN): not in the Product API; column STAWN of Plant Data goes through the custom ABAP service
  // after the product's V4 change set (the BAPI moves the ETag), counted as changes, "#" clears, unchanged = no differences
  const stawnHdr = await page.evaluate(() => { activeTab = 'S_MARC'; renderGrid(); const th = [...document.querySelectorAll('#grid th')].find(t => t.textContent.startsWith('STAWN')); return th ? [th.className, th.textContent] : null; });
  ok('20f grid: STAWN column of Plant Data shown as custom-service field, not as "not in API"', stawnHdr && stawnHdr[0] === '' && /custom service: MARC-STAWN/.test(stawnHdr[1]), JSON.stringify(stawnHdr));
  await page.evaluate(() => { activeTab = 'S_MARA'; renderGrid(); });   // the status column is on the Basic Data tab
  await page.evaluate(() => { sheets.S_MARC.rows[0].cells.STAWN.value = '84099900'; sheets.S_MARA.rows[0].cells.GROES.value = 'M12X55'; });
  await page.click('#btnDry'); await page.waitForFunction(() => /Commodity code \(STAWN\) filled on 1 plant row/.test(fullLog.join('\n')));
  await page.click('#btnRun'); await waitIdle(); L = await logText(); st = await api('/__stats');
  const p1g = await api('/__product?id=ZTEST-001');
  ok('20g change: commodity code sent to /sap/bc/zmm_matmass/stawn after the V4 change set; both counted (2 changes); old → new logged',
    p1g._ProductPlant[0].ZZ_STAWN === '84099900' && p1g.SizeOrDimensionText === 'M12X55' && /ZTEST-001 → ZTEST-001: 2 change\(s\)/.test(L) && /ZTEST-001 plant NL01: commodity code "" → "84099900"/.test(L) && st.stawnPosts >= 1,
    `stawn=${p1g._ProductPlant[0].ZZ_STAWN} groes=${p1g.SizeOrDimensionText} posts=${st.stawnPosts}`);
  await page.click('#btnRun'); await waitIdle();
  ok('20h unchanged commodity code and no other difference: "no differences"', /ZTEST-001 → ZTEST-001: no differences/.test(await logText()));
  await page.evaluate(() => { sheets.S_MARC.rows[0].cells.STAWN.value = '#'; });
  await page.click('#btnRun'); await waitIdle();
  const p1h = await api('/__product?id=ZTEST-001'); const stCol = await page.$$eval('#grid td.st', t => t.map(x => x.textContent));
  ok('20i "#" clears the commodity code through the custom service; status "changed: 1 change(s)" without V4 differences', p1h._ProductPlant[0].ZZ_STAWN === '' && stCol[0] === 'changed: 1 change(s)', `stawn=${JSON.stringify(p1h._ProductPlant[0].ZZ_STAWN)} status=${stCol[0]}`);
  await page.evaluate(() => { sheets.S_MARC.rows[0].cells.STAWN.value = 'ABC'; });
  await page.click('#btnDry'); await page.waitForFunction(() => /must be digits/.test(fullLog.join('\n')));
  ok('20j dry run rejects a non-numeric commodity code', /ZTEST-001 plant NL01: commodity code "ABC" must be digits/.test(await logText()));
  // CSRF on the custom service: a cross-site style POST (text/plain, no token) and a JSON POST without token are rejected
  const csrf = await page.evaluate(async () => {
    const u = withParams($('svcStawn').value.trim()), body = JSON.stringify({ items: [{ material: 'ZTEST-001', plant: 'NL01', commodityCode: '11111111' }] });
    const a = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'text/plain' }, body });
    const b = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body });
    return [a.status, b.status, b.headers.get('x-csrf-token')].join(',');
  });
  const p1k = await api('/__product?id=ZTEST-001');
  ok('20k commodity code service: POST as text/plain → 415, JSON without CSRF token → 403 "Required"; nothing changed; the tool itself fetched a token',
    csrf === '415,403,Required' && p1k._ProductPlant[0].ZZ_STAWN !== '11111111' && /tokstawn-/.test(await page.evaluate(() => csrfStawn || '')), csrf);
  await page.evaluate(() => { sheets.S_MARC.rows[0].cells.STAWN.value = ''; sheets.S_MARA.rows[0].cells.GROES.value = 'M12X50'; });
  await page.click('#btnRun'); await waitIdle();
  // Change in packages: all products of a package read in one $batch (filter with "or", $select), all change sets in one $batch;
  // a product that does not exist (ZTEST-003, created only in test 21) is reported and does not stop the others
  const g2 = await page.evaluate(() => sheets.S_MARA.rows[1].cells.GROES.value);
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.GROES.value = 'M12X60'; sheets.S_MARA.rows[1].cells.GROES.value = 'M8X20'; });
  await page.fill('#batchSize', '20'); await select(['ZTEST-001', 'ZTEST-002', 'ZTEST-003']);
  const s0 = await api('/__stats');
  await page.click('#btnRun'); await waitIdle(); L = await logText(); st = await api('/__stats');
  const c1 = await api('/__product?id=ZTEST-001'), c2 = await api('/__product?id=ZTEST-002');
  ok('20b change in packages: 3 products read in one $batch (one filtered GET per entity set for all, $select), 2 change sets in one $batch; missing product reported, the others saved',
    /3 product\(s\) read in one \$batch/.test(L) && /2 change set\(s\) sent in one \$batch/.test(L) && st.batch - s0.batch <= 3 && st.maxFilterProducts >= 3 &&
    st.selectGets > (s0.selectGets || 0) && c1.SizeOrDimensionText === 'M12X60' && c2.SizeOrDimensionText === 'M8X20' && /ZTEST-003: GET Product\(ZTEST-003\)/.test(L),
    `batches=${st.batch - s0.batch} maxFilterProducts=${st.maxFilterProducts} select=${st.selectGets}`);
  await page.evaluate(g => { sheets.S_MARA.rows[0].cells.GROES.value = 'M12X50'; sheets.S_MARA.rows[1].cells.GROES.value = g; }, g2);
  // step-wise create for the corrected ZTEST-003
  await page.evaluate(() => { sheets.S_MARC.rows[2].cells.WERKS.value = 'NL01'; });
  await page.check('input[name=mode][value=create]'); await page.selectOption('#createMethod', 'step'); await select(['ZTEST-003']);
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  const p3 = await api('/__product?id=ZTEST-003');
  ok('21 step-wise create: product first, views via change set (1:1 views PATCHed, plant POSTed)', p3 && p3._ProductPlant.length === 1 && /ZTEST-003: basic data created as ZTEST-003/.test(L), p3 ? 'plants=' + p3._ProductPlant.length : 'not created');

  // results CSV and resume in a new session
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnResults')]);
  const csvPath = path.join(__dirname, 'results.csv'); await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  ok('22 results CSV: one row per product with SAP number and status', /ZTEST-001;ZTEST-001;done/.test(csv) && /ZTEST-003;ZTEST-003;done/.test(csv), csv.split('\n').length - 1 + ' rows');
  // change set rejection: an invalid value inside the change set leaves nothing changed
  await page.evaluate(() => { sheets.S_MARA.rows[1].cells.GROES.value = 'NEW'; sheets.S_MARA.rows[1].cells.MEINS.value = 'XXX'; });
  await page.check('input[name=mode][value=change]'); await select(['ZTEST-002']);
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  const p2 = await api('/__product?id=ZTEST-002');
  ok('23 rejected change set is atomic: nothing of it saved, error logged', p2.SizeOrDimensionText !== 'NEW' && /change set rejected, nothing of it saved — HTTP 400: Unit of measure XXX/.test(L), 'groes=' + p2.SizeOrDimensionText);

  const page2 = await ctx.newPage(); page = page2;
  await page.goto(BASE + '/tool.html'); await page.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true));   // settings are in collapsed sections await page.uncheck('#autoDl');
  ok('24a after reload: log and results of the last run available', await page.isVisible('#lastRun') && /Last run: /.test(await page.textContent('#lastRunInfo')), await page.textContent('#lastRunInfo')); await page.setInputFiles('#file', FILE);
  await page.waitForFunction(() => /File loaded/.test(fullLog.join('\n')));
  await page.setInputFiles('#resFile', csvPath);
  await page.waitForFunction(() => /Results loaded/.test(fullLog.join('\n')), null, { timeout: 10000 });
  L = await logText();
  const inc = await page.evaluate(() => sheets.S_MARA.rows.map(r => r.include));
  ok('24 resume: results loaded, done products deselected', /Results loaded: 3 done/.test(L) && inc.every(x => !x), inc.join(','));

  // resume from this browser (IndexedDB) without a results file
  await page.evaluate(() => { results.clear(); sheets.S_MARA.rows.forEach(r => { r.include = true; r.target = ''; }); });
  await page.click('#btnResume'); await page.waitForFunction(() => /Resumed from this browser/.test(fullLog.join('\n')));
  L = await logText(); const inc2 = await page.evaluate(() => sheets.S_MARA.rows.map(r => r.include + ':' + r.target));
  ok('24b "Resume last run": results of this file taken from the browser, done deselected, failed (ZTEST-002, change set rejected in test 23) selected again, SAP numbers filled', /Resumed from this browser \(\d+ result\(s\)/.test(L) && inc2.join(',') === 'false:ZTEST-001,true:ZTEST-002,false:ZTEST-003', inc2.join(','));
  // export changed XML and read it again
  await page.evaluate(() => { sheets.S_MARA.rows[0].cells.GROES.value = 'EXPORTED'; });
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const xPath = path.join(__dirname, 'roundtrip.xml'); await dl2.saveAs(xPath);
  await page.setInputFiles('#file', xPath); await page.waitForFunction(() => sheets.S_MARA && /roundtrip/.test(fileName));
  ok('25 "Save changed file" round trip: file readable again, change kept', await page.evaluate(() => sheets.S_MARA.rows[0].cells.GROES.value) === 'EXPORTED');

  // internal numbering: Product '' → SAP assigns the next number (deep insert and step-wise)
  await page.uncheck('#extNum'); await page.check('input[name=mode][value=create]');
  await page.evaluate(() => { results.clear(); sheets.S_MARA.rows.forEach(r => { r.include = prodOf(r) === 'ZTEST-001'; r.target = ''; }); });
  const pl0 = await page.evaluate(() => toPayload(buildProduct(sheets.S_MARA.rows[0])));
  await page.selectOption('#createMethod', 'deep'); await page.click('#btnRun'); await waitIdle();
  await page.evaluate(() => sheets.S_MARA.rows.forEach(r => r.include = prodOf(r) === 'ZTEST-002'));
  await page.selectOption('#createMethod', 'step'); await page.click('#btnRun'); await waitIdle();
  const tg = await page.evaluate(() => sheets.S_MARA.rows.map(r => r.target));
  st = await api('/__stats'); const pn = await api('/__product?id=' + tg[0]);
  ok('25a internal numbering: product created through V2 (Product "", SAP unit), views and other basic data through V4; number in column SAP product',
    st.v2post === 2 && /^4\d{6}$/.test(tg[0]) && /^4\d{6}$/.test(tg[1]) && tg[0] !== tg[1] && pn && pn._ProductPlant.length === 1 && pn._ProductValuation.length === 1 && pn.ProductGroup === (await page.evaluate(() => toPayload(buildProduct(sheets.S_MARA.rows[0])).ProductGroup)),
    `v2post=${st.v2post} targets=${tg.join(',')} plants=${pn && pn._ProductPlant.length}`);
  // downloadable example template: link works, file loads, validates, V2 payload for HAWA and SERV
  const [dlt] = await Promise.all([page.waitForEvent('download'), page.click('#lnkTemplate')]);
  const tPath = path.join(__dirname, 'template_download.xml'); await dlt.saveAs(tPath);
  await page.evaluate(() => fullLog.length = 0);
  await page.setInputFiles('#file', tPath); await page.waitForFunction(() => /File loaded/.test(fullLog.join('\n')));
  await page.click('#btnDry'); await page.waitForFunction(() => /Validation against/.test(fullLog.join('\n')));
  L = await logText();
  const tv = await page.evaluate(() => sheets.S_MARA.rows.map(r => v2Payload(buildProduct(r)).BaseUnit + '/' + toPayload(buildProduct(r)).ProductType));
  const tc = await page.evaluate(() => ['S_MARA', 'S_MARC', 'S_MARD', 'S_MBEW'].map(k => sheets[k].rows.length).join(','));
  ok('25b example template: download, load (2 products, 2 MARC, 2 MARD, 2 MBEW), no validation problems, V2 units M and AU',
    /File loaded: 2 product/.test(L) && tc === '2,2,2,2' && /Validation against \$metadata: no problems/.test(L) && tv.join(',') === 'M/HAWA,AU/SERV', `${tc} ${tv.join(',')}`);
  // unit translation: SAP unit via built-in T006 table, own line via the text field
  await page.evaluate(() => { sheets.S_MARA.rows[1].cells.MEINS.value = 'AU'; sheets.S_MARA.rows[0].cells.MEINS.value = 'STK'; });
  await page.evaluate(() => { document.getElementById('unitBox').open = true; });
  await page.fill('#unitMap', 'STK=MTR'); await page.click('#btnUnitSave');
  const tu = await page.evaluate(() => sheets.S_MARA.rows.map(r => toPayload(buildProduct(r)).BaseISOUnit));
  L = await logText();
  ok('25c unit translation: AU → C62 (T006), STK → MTR (own line), logged', tu.join(',') === 'MTR,C62' && /Unit AU translated to ISO C62 \(T006\)/.test(L) && /Unit STK translated to ISO MTR \(own table\)/.test(L), tu.join(','));
  // auto download at the end of a run + last run kept in the browser
  await page.check('#autoDl');
  const dls = []; page.on('download', d => dls.push(d.suggestedFilename()));
  await page.check('input[name=mode][value=change]'); await page.evaluate(() => sheets.S_MARA.rows.forEach((r, i) => r.include = i === 0));
  await page.click('#btnRun'); await waitIdle(); await page.waitForTimeout(1500);
  const lr = await page.evaluate(() => JSON.parse(localStorage.getItem('zmmmatmassmdg.lastRun') || 'null'));
  ok('25d end of run: log and results downloaded automatically, last run kept in the browser (after reload too)',
    dls.some(n => /_log_.*\.txt$/.test(n)) && dls.some(n => /_results_.*\.csv$/.test(n)) && lr && /finished: /.test(lr.state) && lr.log.length > 100 && /src;product;status/.test(lr.results), dls.join(', ') + ' | ' + (lr && lr.state));
  await page.uncheck('#autoDl');
  // Read from SAP: selection of fields and products into the Product template; columns hidden; round trip with Change
  await page.click('#srcSap'); await page.waitForFunction(() => typeof tpl !== 'undefined' && tpl && document.querySelector('#selTokens button'));
  await page.evaluate(() => { readSel.clear(); ['S_MARA.GROES', 'S_MARA.MAKTX', 'S_MARC.DISMM', 'S_MARM.BRGEW'].forEach(k => readSel.add(k)); renderTokens(); });
  await page.click('#selTokens button'); await page.waitForSelector('#pkFields label');
  const pk = await page.$$eval('#pkFields label', ls => ls.length);
  await page.selectOption('#critRows .crit .cOp', 'sw'); await page.fill('#critRows .crit .cLow', 'ZTEST');
  await page.click('#btnCritAdd');
  await page.selectOption('#critRows .crit:last-child .cSign', 'E'); await page.fill('#critRows .crit:last-child .cLow', 'ZTEST-003');
  await page.click('#btnCount'); await page.waitForFunction(() => /found|rror|Enter/.test(document.getElementById('readState').textContent));
  const cnt = await page.textContent('#readState'); const flt = (await api('/__stats')).lastFilter;
  const r0 = await api('/__stats');
  await page.click('#btnRead'); await page.waitForFunction(() => /hidden|rror|No /.test(document.getElementById('readState').textContent) && !document.getElementById('btnRead').disabled);
  const rs = await page.textContent('#readState'); st = await api('/__stats');
  const sap1 = await api('/__product?id=ZTEST-001'), sap2 = await api('/__product?id=ZTEST-002');
  const rd = await page.evaluate(() => ({
    mara: sheets.S_MARA.rows.map(r => [prodOf(r), r.cells.GROES.value, r.cells.SPRAS.value, r.cells.MAKTX.value, r.cells.MEINS.value, r.cells.BISMT.value].join('|')),
    marc: sheets.S_MARC.rows.map(r => [prodOf(r), r.cells.WERKS.value, r.cells.DISMM.value].join('|')),
    marm: sheets.S_MARM.rows.map(r => [prodOf(r), r.cells.MEINH.value, r.cells.BRGEW.value].join('|')),
    mbew: (sheets.S_MBEW || { rows: [] }).rows.length,
    hid: [sheets.S_MARA.hidden.has('BISMT'), sheets.S_MARA.hidden.has('GROES'), sheets.S_MARA.hidden.has('PRODUCT'), sheets.S_MARM.hidden.has('BRGEW'), sheets.S_MARM.hidden.has('UMREZ')].join(','),
    mode: mode(), grid: document.querySelectorAll('#grid th').length }));
  const want1 = ['ZTEST-001', sap1.SizeOrDimensionText, 'EN', sap1._ProductDescription.find(d => d.Language === 'EN').ProductDescription, sap1.BaseISOUnit, ''].join('|');
  ok('27 read from SAP: criteria (starts with ZTEST, exclude ZTEST-003) → 2 products; selected fields of 3 sheets in the Product template (description EN, base unit), one $batch read, $select',
    /2 product\(s\) found/.test(cnt) && /startswith\(Product,'ZTEST'\) and not \(Product eq 'ZTEST-003'\)/.test(flt) && rd.mara.length === 2 && rd.mara[0] === want1 &&
    rd.mara[1].startsWith('ZTEST-002|' + sap2.SizeOrDimensionText + '|') && rd.marc.length === sap1._ProductPlant.length + sap2._ProductPlant.length &&
    rd.marc[0] === `ZTEST-001|${sap1._ProductPlant[0].Plant}|${sap1._ProductPlant[0]._ProductPlantSupplyPlanning.MRPType}` &&
    rd.marm.includes(`ZTEST-001|${sap1._ProductUnitOfMeasure[0].AlternativeISOUnit}|${sap1._ProductUnitOfMeasure[0].GrossWeight}`) && rd.mbew === 0 && st.batch - r0.batch === 1 && pk > 10,
    `${cnt} | filter=${flt} | ${rd.mara.join(' ; ')} | marc=${rd.marc.join(',')} | marm=${rd.marm.join(',')} | batches=${st.batch - r0.batch}`);
  ok('27a columns: not selected and empty hidden (BISMT), selected and keys visible (GROES, PRODUCT, BRGEW), grid shows only visible columns; mode set to Change',
    rd.hid === 'true,false,false,false,true' && rd.mode === 'change' && rd.grid < 10, `hidden=${rd.hid} mode=${rd.mode} gridColumns=${rd.grid} | ${rs}`);
  const [dlr] = await Promise.all([page.waitForEvent('download'), page.click('#btnReadDl')]);
  const rPath = path.join(__dirname, 'read_from_sap.xml'); await dlr.saveAs(rPath); const rx = fs.readFileSync(rPath, 'utf8');
  await page.click('#srcFile'); await page.evaluate(() => fullLog.length = 0);
  await page.setInputFiles('#file', rPath); await page.waitForFunction(() => /File loaded/.test(fullLog.join('\n')));
  const back = await page.evaluate(() => ({ n: sheets.S_MARA.rows.length, hid: sheets.S_MARA.hidden ? sheets.S_MARA.hidden.has('BISMT') : false, groes: sheets.S_MARA.rows[0].cells.GROES.value }));
  await page.check('input[name=mode][value=change]'); await page.evaluate(() => sheets.S_MARA.rows.forEach(r => r.include = true));
  await page.click('#btnRun'); await waitIdle(); L = await logText();
  ok('27b download: Product template with the SAP rows and hidden columns (ss:Hidden), loads again (hidden columns kept), Change on the unchanged file gives "no differences"',
    /Product_from_SAP_/.test(dlr.suggestedFilename()) && /<Column[^>]*ss:Hidden="1"/.test(rx) && /S_MARM/.test(rx) && back.n === 2 && back.hid && back.groes === sap1.SizeOrDimensionText &&
    /ZTEST-001 → ZTEST-001: no differences/.test(L) && /ZTEST-002 → ZTEST-002: no differences/.test(L),
    `${dlr.suggestedFilename()} rows=${back.n} hiddenKept=${back.hid}`);
  // any template field as criterion: plant + MRP type on the same plant row; not filterable property not offered
  await page.click('#srcSap'); await page.waitForSelector('#critRows .crit');
  const opts = await page.$$eval('#critRows .crit:first-child .cField option', o => o.map(x => x.value));
  await page.evaluate(() => { $('critRows').innerHTML = ''; addCrit('I', 'S_MARC.WERKS', 'eq', 'NL01'); addCrit('I', 'S_MARC.DISMM', 'eq', 'VB'); addCrit('I', 'S_MARA.PRODUCT', 'sw', 'ztest'); });
  const opsDismm = await page.$$eval('#critRows .crit:nth-child(2) .cOp option', o => o.map(x => x.value).join(','));
  const g0 = await api('/__stats'); await page.evaluate(() => { $('readState').textContent = ''; });
  await page.click('#btnCount'); await page.waitForFunction(() => /found|Error|Enter|not filterable/.test(document.getElementById('readState').textContent));
  const cnt2 = await page.textContent('#readState'); L = await logText(); const fl2 = ((await api('/__stats')).filters || []).slice((g0.filters || []).length);
  const want = (await Promise.all(['ZTEST-001', 'ZTEST-002', 'ZTEST-003'].map(id => api('/__product?id=' + id))))
    .filter(pr => pr && pr._ProductPlant.some(pl => pl.Plant === 'NL01' && pl._ProductPlantSupplyPlanning.MRPType === 'VB')).length;
  ok('27c any template field as criterion: Plant NL01 and MRP type VB on the same plant row (ProductPlantSupplyPlanning filtered on Plant too), material number "ztest" upper-cased; not filterable field (BISMT) not offered; operators by type',
    opts.length > 300 && opts.includes('S_MARC.DISMM') && opts.includes('S_MBEW.BKLAS') && !opts.includes('S_MARA.BISMT') && opsDismm === 'eq,bt,sw' &&
    new RegExp(`^${want} product\\(s\\) found`).test(cnt2) && want === 1 && fl2.some(x => /^ProductPlantSupplyPlanning:/.test(x) && /MRPType eq 'VB'/.test(x) && /Plant eq 'NL01'/.test(x)) &&
    fl2.some(x => /^Product:startswith\(Product,'ZTEST'\)/.test(x)),
    `options=${opts.length} ops=${opsDismm} | ${cnt2} | expected ${want} | ${fl2.join(' ; ')}`);
  ok('26 no JavaScript errors on the page', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'screenshot.png'), fullPage: true });
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'unit_test_results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
