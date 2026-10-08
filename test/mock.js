// Test double of API_PRODUCT_2 (OData V4) with the behaviour relevant for the upload tool.
// Structure (entity types, keys, navigations, Computed/Immutable) follows the DS4 $metadata of 25 Sep 2026.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm');
const PORT = parseInt(process.env.PORT || '8099', 10);
const SVC = '/sap/opu/odata4/sap/api_product/srvd_a2x/sap/product/0002/';
const TOOL = path.join(__dirname, '../webapp/tool.html');
const SVC_V2 = '/sap/opu/odata/sap/API_PRODUCT_SRV/'; const TOKEN_V2 = 'tokv2-' + Date.now();

// --- property lists taken from the tool's own mapping table (what the tool can send) plus keys/computed fields
const html = fs.readFileSync(TOOL, 'utf8');
const treeSrc = html.split('const TREE = ')[1].split('\n];')[0] + '\n]';
const TREE = vm.runInNewContext('(' + treeSrc + ')');
const T = {
  Product_Type: { keys: ['Product'], navs: { _ProductDescription: ['ProductDescription_Type', 1], _ProductProcurement: ['ProductProcurement_Type', 0],
    _ProductSales: ['ProductSales_Type', 0], _ProductStorage: ['ProductStorage_Type', 0], _ProductQualityManagement: ['ProductQualityManagement_Type', 0],
    _ProductUnitOfMeasure: ['ProductUnitOfMeasure_Type', 1], _ProductPlant: ['ProductPlant_Type', 1], _ProductValuation: ['ProductValuation_Type', 1],
    _ProductSalesDelivery: ['ProductSalesDelivery_Type', 1] } },
  ProductDescription_Type: { keys: ['Product', 'Language'] },
  ProductProcurement_Type: { keys: ['Product'] }, ProductSales_Type: { keys: ['Product'] }, ProductStorage_Type: { keys: ['Product'] },
  ProductQualityManagement_Type: { keys: ['Product'] },
  ProductUnitOfMeasure_Type: { keys: ['Product', 'AlternativeUnit'], navs: { _ProductUnitOfMeasureEAN: ['ProductUnitOfMeasureEAN_Type', 1] } },
  ProductUnitOfMeasureEAN_Type: { keys: ['Product', 'AlternativeUnit', 'ConsecutiveNumber'] },
  ProductPlant_Type: { keys: ['Product', 'Plant'], navs: { _ProductPlantSupplyPlanning: ['ProductPlantSupplyPlanning_Type', 0],
    _ProductPlantProcurement: ['ProductPlantProcurement_Type', 0], _ProductPlantQualityManagement: ['ProductPlantQualityManagement_Type', 0],
    _ProdPlantInternationalTrade: ['ProdPlntInternationalTrade_Type', 0], _ProductPlantSales: ['ProductPlantSales_Type', 0],
    _ProductPlantWorkScheduling: ['ProductPlantWorkScheduling_Type', 0], _ProductPlantCosting: ['ProductPlantCosting_Type', 0],
    _ProductPlantStorage: ['ProductPlantStorage_Type', 0], _ProductPlantForecast: ['ProductPlantForecast_Type', 0],
    _ProductPlantStorageLocation: ['ProductPlantStorageLocation_Type', 1], _ProductPlantMRP: ['ProductPlantMRP_Type', 1],
    _ProductPlantInspTypeSetting: ['ProductPlantInspTypSetting_Type', 1] } },
  ProductPlantSupplyPlanning_Type: { keys: ['Product', 'Plant'] }, ProductPlantProcurement_Type: { keys: ['Product', 'Plant'] },
  ProductPlantQualityManagement_Type: { keys: ['Product', 'Plant'] }, ProdPlntInternationalTrade_Type: { keys: ['Product', 'Plant'] },
  ProductPlantSales_Type: { keys: ['Product', 'Plant'] }, ProductPlantWorkScheduling_Type: { keys: ['Product', 'Plant'] },
  ProductPlantCosting_Type: { keys: ['Product', 'Plant'] }, ProductPlantStorage_Type: { keys: ['Product', 'Plant'] },
  ProductPlantForecast_Type: { keys: ['Product', 'Plant'] },
  ProductPlantStorageLocation_Type: { keys: ['Product', 'Plant', 'StorageLocation'] },
  ProductPlantMRP_Type: { keys: ['Product', 'MRPArea', 'Plant'] },
  ProductPlantInspTypSetting_Type: { keys: ['InspectionLotType', 'Product', 'Plant'] },
  ProductValuation_Type: { keys: ['Product', 'ValuationArea', 'ValuationType'], navs: { _ProductValuationAccounting: ['ProductValuationAccounting_Type', 0],
    _ProductValuationCosting: ['ProductValuationCosting_Type', 0] } },
  ProductValuationAccounting_Type: { keys: ['Product', 'ValuationArea', 'ValuationType'] },
  ProductValuationCosting_Type: { keys: ['Product', 'ValuationArea', 'ValuationType'] },
  ProductSalesDelivery_Type: { keys: ['Product', 'ProductSalesOrg', 'ProductDistributionChnl'], navs: { _ProdSalesDeliverySalesTax: ['ProdSalesDeliverySalesTax_Type', 1] } },
  ProdSalesDeliverySalesTax_Type: { keys: ['Product', 'Country', 'ProductSalesTaxCategory', 'ProductSalesOrg', 'ProductDistributionChnl'] }
};
const SET = t => ({ ProdPlntInternationalTrade_Type: 'ProductPlantInternationalTrade', ProductPlantInspTypSetting_Type: 'ProductPlantInspTypeSetting' }[t] || t.replace(/_Type$/, ''));
const TYPE_OF_SET = Object.fromEntries(Object.keys(T).map(t => [SET(t), t]));
// node id in the tool -> type, via navigation names
const navType = {}; for (const [t, d] of Object.entries(T)) for (const [n, [tt]] of Object.entries(d.navs || {})) navType[n] = tt;
for (const t of Object.values(T)) t.props = {};
for (const n of TREE) {
  const t = n.parent ? navType[n.nav] : 'Product_Type';
  for (const p of Object.values(Object.assign({}, n.fields, n.carry || {}))) if (!p.startsWith('(')) T[t].props[p] = 1;
}
T.ProdSalesDeliverySalesTax_Type.props.ProductSalesTaxCategory = 1; T.ProdSalesDeliverySalesTax_Type.props.ProductTaxClassification = 1;
for (const [t, d] of Object.entries(T)) d.keys.forEach(k => d.props[k] = 1);
Object.assign(T.Product_Type.props, { LastChangeDateTime: 1, CreationDate: 1, BaseUnit: 1, CreatedByUser: 1 });
Object.assign(T.ProductUnitOfMeasure_Type.props, { AlternativeSAPUnit: 1 });
Object.assign(T.ProductValuation_Type.props, { BaseISOUnit: 1 });   // DS4: unit reference of ProductPriceUnitQuantity
Object.assign(T.ProductUnitOfMeasureEAN_Type.props, { AlternativeISOUnit: 1 });
const COMPUTED = { Product_Type: ['LastChangeDateTime', 'CreationDate', 'BaseUnit', 'CreatedByUser'], ProductUnitOfMeasure_Type: ['AlternativeUnit', 'AlternativeSAPUnit'] };
// Key properties that come from the parent. DS4 (25 Sep 2026): not filled by SAP in a deep insert or POST via
// navigation — they must be in the body ('Property PLANT is a key and cannot be initial'), although $metadata marks them Computed.
function computedKeys(t) {
  if (t === 'Product_Type') return [];
  const own = { ProductDescription_Type: ['Language'], ProductUnitOfMeasureEAN_Type: ['ConsecutiveNumber'], ProductPlant_Type: ['Plant'],
    ProductPlantStorageLocation_Type: ['StorageLocation'], ProductPlantMRP_Type: ['MRPArea'], ProductPlantInspTypSetting_Type: ['InspectionLotType'],
    ProductValuation_Type: ['ValuationArea', 'ValuationType'], ProductSalesDelivery_Type: ['ProductSalesOrg', 'ProductDistributionChnl'],
    ProdSalesDeliverySalesTax_Type: ['Country', 'ProductSalesTaxCategory'] }[t] || [];
  return T[t].keys.filter(k => !own.includes(k));
}
const STRINGS = new Set(['SafetySupplyDurationInDays', 'BackwardCnsmpnPeriodInWorkDays', 'FwdConsumptionPeriodInWorkDays', 'PlanningTimeFence',
  'DevaluationYearCount', 'ProductDocumentPageNumber', 'ProdChmlCmplncRelevanceCode', 'ProductComponentBackflushCode', 'StorageCostsPercentageCode',
  'CountryOfOrigin', 'RegionOfOrigin', 'PriceDeterminationControl', 'ShelfLifeExpirationDatePeriod', 'ShelfLifeExprtnDateRndngRule']);
function edmType(p) {
  if (p === 'LastChangeDateTime') return 'Edm.DateTimeOffset';
  if (STRINGS.has(p) || /ISOUnit$|Unit$/.test(p) || /Unit$|ISOUnit|Code$|Group$|Profile$|Type$|Category$|Indicator$|Status$|Procedure$|Key$/.test(p) && !/Quantity|Is[A-Z]|Has[A-Z]/.test(p)) return 'Edm.String';
  if (/Date$/.test(p)) return 'Edm.Date';
  if (p === 'LastChangeDateTime') return 'Edm.DateTimeOffset';
  if (/^(Is|Has)[A-Z]|[a-z](Is|Has)[A-Z]|IsActive|Allwd$|Required$|IsReset|IsFixed|IsRelevant$|Possible$|Prfrd$|Triggered$|SampleSize$|AppraisalCosts$|Inspection$|MaterialSpec$|BatchCharc$|AutomSpecAssgmt$|HasCharc$|MultipleSpec$|HandlingUnit$|ConfignSpecification$|NotAllowed$|Deductible$|ZZ1_SERNP_PRD|Relevant$|Origin$|QtyStruc$|Inhouse$|Component$|ClosedPackaging$|TareWeight$|Configurable$|Pilferable$|HzdsSubstances$|Reqd$/.test(p)) return 'Edm.Boolean';
  if (/Quantity|Weight$|Volume$|Price|Percent|Length$|Width$|Height$|Capacity|Tolerance|QuarantinePeriod$|StoragePeriod$|Duration|InDays$|InWorkDays$|Time$|Costs$|Numerator$|Denominator$|ShelfLife|Multiplier|LeadTime|WrkgDays|Qty$|LotSize$|RatioInPct|SlipsToPrintQty|Unit(Qty|Quantity)$/.test(p)) return 'Edm.Decimal';
  return 'Edm.String';
}
const MAXLEN = { Product: 18, ProductDescription: 40, Language: 2, Plant: 4, StorageLocation: 4, ValuationArea: 4, ProductType: 4, ProductGroup: 9 };
// quantity/amount -> unit/currency property of the same entity (DS4 $metadata: SAP__measures.Unit / ISOCurrency)
const MEASURE_REF = { GrossWeight: 'WeightISOUnit', NetWeight: 'WeightISOUnit', ProductVolume: 'VolumeISOUnit', ProductPriceUnitQuantity: 'BaseISOUnit',
  MovingAveragePrice: 'Currency', StandardPrice: 'Currency' };
function metadata() {
  let x = '<?xml version="1.0" encoding="utf-8"?><edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>' +
    '<Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="com.sap.gateway.srvd_a2x.api_product_2.v0001" Alias="SAP__self">';
  const ann = [];
  for (const [t, d] of Object.entries(T)) {
    x += `<EntityType Name="${t}"><Key>${d.keys.map(k => `<PropertyRef Name="${k}"/>`).join('')}</Key>`;
    for (const p of Object.keys(d.props)) {
      const ty = edmType(p);
      x += `<Property Name="${p}" Type="${ty}"` + (ty === 'Edm.String' ? ` MaxLength="${MAXLEN[p] || (/ISOUnit|Unit$/.test(p) ? 3 : 40)}"` : '') +
        (ty === 'Edm.Decimal' ? ' Precision="13" Scale="3"' : '') + '/>';
      if ((COMPUTED[t] || []).includes(p) || computedKeys(t).includes(p)) ann.push(`<Annotations Target="SAP__self.${t}/${p}"><Annotation Term="SAP__core.Computed"/></Annotations>`);
      // Measures annotations as SAP writes them (alias SAP__measures, external <Annotations> block)
      if (MEASURE_REF[p] && d.props[MEASURE_REF[p]]) ann.push(`<Annotations Target="SAP__self.${t}/${p}"><Annotation Term="SAP__measures.${MEASURE_REF[p] === 'Currency' ? 'ISOCurrency' : 'Unit'}" Path="${MEASURE_REF[p]}"/></Annotations>`);
    }
    for (const [n, [tt, many]] of Object.entries(d.navs || {})) x += `<NavigationProperty Name="${n}" Type="${many ? 'Collection(' : ''}com.sap.gateway.srvd_a2x.api_product_2.v0001.${tt}${many ? ')' : ''}"/>`;
    x += '</EntityType>';
  }
  x += '<EntityContainer Name="Container">' + Object.keys(T).map(t => `<EntitySet Name="${SET(t)}" EntityType="com.sap.gateway.srvd_a2x.api_product_2.v0001.${t}"/>`).join('') + '</EntityContainer>';
  // DS4-like filter restriction (test: a property that is not offered as selection criterion)
  ann.push('<Annotations Target="SAP__self.Container/Product"><Annotation Term="SAP__capabilities.FilterRestrictions"><Record><PropertyValue Property="NonFilterableProperties"><Collection><PropertyPath>ProductOldID</PropertyPath></Collection></PropertyValue></Record></Annotation></Annotations>');
  return x + ann.join('') + '</Schema></edmx:DataServices></edmx:Edmx>';
}

// --- store: product -> node { type, data, navs }
let store = new Map(); let seq = 1000; const TOKEN = 'tok-' + Date.now();
const UNIT_SAP = { PCE: 'PC', BX: 'BOX', KGM: 'KG', EA: 'EA', MTR: 'M' };
const PLANTS = new Set(['NL01', 'NL02']); const AREA_CUR = { NL01: 'EUR', NL02: 'EUR' }; const stats = { post: 0, patch: 0, batch: 0, get: 0, changesets: 0, preconditionFailed: 0 };
class ODataError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function stamp() { return new Date(Date.now() + (seq++)).toISOString(); }
function etagOf(prod) { return `W/"${prod.data.LastChangeDateTime}"`; }
function checkProps(t, obj, creating) {
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('_')) { const n = (T[t].navs || {})[k]; if (!n) throw new ODataError(400, `Property '${k}' is invalid`); continue; }
    if (!T[t].props[k]) throw new ODataError(400, `Property '${k}' is invalid`);
    if ((COMPUTED[t] || []).includes(k)) throw new ODataError(400, `Property '${k}' is computed and cannot be set`);
    const ty = edmType(k);
    if (ty === 'Edm.Decimal' && typeof v !== 'number') throw new ODataError(400, `Value for '${k}' is not a valid Edm.Decimal`);
    if (ty === 'Edm.Boolean' && typeof v !== 'boolean') throw new ODataError(400, `Value for '${k}' is not a valid Edm.Boolean`);
    if (/ISOUnit$/.test(k) && v && !UNIT_SAP[v]) throw new ODataError(400, `Unit of measure ${v} (ISO) is not defined`);
  }
  // DS4 behaviour (25 Sep 2026): a quantity without its unit reference in the same entity is rejected
  if (t === 'ProductValuation_Type' && obj.ProductPriceUnitQuantity !== undefined && !obj.BaseISOUnit)
    throw new ODataError(400, "Together with property 'ProductPriceUnitQuantity' also property 'BaseISOUnit' needs to be provided");
  if (t === 'ProductValuation_Type' && (obj.MovingAveragePrice !== undefined || obj.StandardPrice !== undefined) && !obj.Currency)
    throw new ODataError(400, "Together with property 'MovingAveragePrice' also property 'Currency' needs to be provided");
  // DS4 behaviour (8 Oct 2026): a weight on Product or on a unit of measure without WeightISOUnit in the same request is rejected
  for (const w of ['GrossWeight', 'NetWeight'])
    if (obj[w] !== undefined && !obj.WeightISOUnit) throw new ODataError(400, `Together with property '${w}' also property 'WeightISOUnit' needs to be provided`);
}
function makeNode(t, obj, parentKeys, prod, implicit) {
  checkProps(t, obj, true);
  const data = {}; const node = { type: t, data, navs: {} };
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) data[k] = v;
  for (const k of computedKeys(t)) {
    if (implicit) { data[k] = parentKeys[k]; continue; }   // 1:1 view that SAP creates on its own
    if (k === 'AlternativeUnit' && data[k] === undefined) { data[k] = parentKeys[k]; continue; }   // computed in the parent (from AlternativeISOUnit)
    if (data[k] === '' && parentKeys[k]) data[k] = parentKeys[k];   // empty Product in a deep insert with internal numbering
    if (data[k] === undefined || data[k] === '') throw new ODataError(400, `Property ${k.toUpperCase()} is a key and cannot be initial`);
    if (String(data[k]) !== String(parentKeys[k])) throw new ODataError(400, `Key ${k} ${data[k]} does not match the parent (${parentKeys[k]})`);
  }
  if (t === 'ProductUnitOfMeasure_Type') { data.AlternativeUnit = UNIT_SAP[data.AlternativeISOUnit]; data.AlternativeSAPUnit = data.AlternativeUnit; }
  if (t === 'ProductPlant_Type' && !PLANTS.has(data.Plant)) throw new ODataError(400, `Plant ${data.Plant} does not exist`);
  if (t === 'ProductValuation_Type' && data.ValuationType === undefined) data.ValuationType = '';
  if (t === 'ProductValuation_Type' && AREA_CUR[data.ValuationArea] && data.Currency && data.Currency !== AREA_CUR[data.ValuationArea])
    throw new ODataError(400, `Currency ${data.Currency} provided is incorrect for Product ${data.Product} Valuation ${data.ValuationArea}`);
  for (const k of T[t].keys) if (data[k] === undefined || data[k] === '' && k !== 'ValuationType') throw new ODataError(400, `Key ${k} missing for ${SET(t)}`);
  const keys = Object.fromEntries(T[t].keys.map(k => [k, data[k]]));
  for (const [n, [tt, many]] of Object.entries(T[t].navs || {})) {
    const v = obj[n];
    if (many) { node.navs[n] = []; for (const c of (v || [])) addChild(node, n, c); }
    else node.navs[n] = makeNode(tt, v || {}, keys, prod, !v);   // 1:1 views exist implicitly, like MARA/MARC views in SAP
  }
  return node;
}
function addChild(parent, nav, obj) {
  const [tt, many] = T[parent.type].navs[nav];
  const keys = Object.fromEntries(T[parent.type].keys.map(k => [k, parent.data[k]]));
  const child = makeNode(tt, obj, keys);
  if (!many) throw new ODataError(400, `${nav} exists already, use PATCH`);
  if (parent.navs[nav].some(x => T[tt].keys.every(k => String(x.data[k]) === String(child.data[k])))) throw new ODataError(400, `${SET(tt)} exists already`);
  parent.navs[nav].push(child); return child;
}
function serialize(node, prod) {
  const o = { '@odata.etag': etagOf(prod), ...node.data };
  for (const [n, v] of Object.entries(node.navs)) o[n] = Array.isArray(v) ? v.map(x => serialize(x, prod)) : serialize(v, prod);
  return o;
}
function parseKeys(s) { const o = {}; s.replace(/(\w+)='((?:[^']|'')*)'/g, (_, k, v) => { o[k] = decodeURIComponent(v.replace(/''/g, "'")); }); return o; }
function find(node, t, keys) {
  if (node.type === t && Object.entries(keys).every(([k, v]) => String(node.data[k]) === v)) return node;
  for (const v of Object.values(node.navs)) for (const c of (Array.isArray(v) ? v : [v])) { const f = find(c, t, keys); if (f) return f; }
  return null;
}
function resolve(p) {   // "Set(keys)[/nav]..." -> { node, prod, nav }
  const segs = p.split('/'); const m = segs[0].match(/^(\w+)\((.*)\)$/);
  if (!m) throw new ODataError(404, 'Resource not found ' + p);
  const t = TYPE_OF_SET[m[1]]; const keys = parseKeys(m[2]); if (!keys.Product && m[2].startsWith("'")) keys.Product = decodeURIComponent(m[2].slice(1, -1));
  const prod = store.get(keys.Product); if (!prod) throw new ODataError(404, `Product ${keys.Product} not found`);
  let node = find(prod, t, keys); if (!node) throw new ODataError(404, `${m[1]} not found`);
  let nav = null;
  for (const s of segs.slice(1)) {
    if (!(T[node.type].navs || {})[s]) throw new ODataError(404, 'Navigation not found ' + s);
    const v = node.navs[s]; if (Array.isArray(v) || s === segs[segs.length - 1]) { nav = s; break; } node = v;
  }
  return { node, prod, nav };
}
// Minimal OData $filter: and/or/not, parentheses, eq ne ge le gt lt, startswith(prop,'v'), strings and dates
function compileFilter(expr) {
  const toks = expr.match(/'(?:[^']|'')*'|\(|\)|,|\d{4}-\d{2}-\d{2}|[A-Za-z_]\w*|-?\d+(?:\.\d+)?/g) || []; let i = 0;
  const peek = () => toks[i], next = () => toks[i++], val = t => t.startsWith("'") ? t.slice(1, -1).replace(/''/g, "'") : t;
  const cmp = (a, b) => { a = String(a ?? ''); return a < b ? -1 : a > b ? 1 : 0; };
  function primary() {
    const t = next();
    if (t === '(') { const e = orE(); next(); return e; }
    if (t === 'not') { const e = primary(); return o => !e(o); }
    if (t === 'startswith') { next(); const f = next(); next(); const v = val(next()); next(); return o => String(o[f] ?? '').startsWith(v); }
    const op = next(), v = val(next());
    return o => { const c = cmp(o[t], v); return { eq: c === 0, ne: c !== 0, ge: c >= 0, le: c <= 0, gt: c > 0, lt: c < 0 }[op]; };
  }
  function andE() { let e = primary(); while (peek() === 'and') { next(); const a = e, b = primary(); e = o => a(o) && b(o); } return e; }
  function orE() { let e = andE(); while (peek() === 'or') { next(); const a = e, b = andE(); e = o => a(o) || b(o); } return e; }
  return orE();
}
function handle(method, p, body, headers) {   // returns { status, body }
  const [pathOnly] = p.split('?');
  if (method === 'GET') {
    stats.get++;
    const fa = /^(\w+)$/.test(pathOnly) && decodeURIComponent(p.split('?')[1] || '').match(/\$filter=ValuationArea eq '([^']*)'/);
    if (fa) {   // ProductValuation?$filter=ValuationArea eq '…'&$top=1 -> currency of the valuation area
      const out = []; for (const prod of store.values()) for (const v of prod.navs._ProductValuation || []) if (v.data.ValuationArea === fa[1]) out.push({ ValuationArea: fa[1], Currency: v.data.Currency });
      return { status: 200, body: { value: out.slice(0, 1) } };
    }
    const qs = decodeURIComponent(p.split('?')[1] || '');
    const selM = qs.match(/\$select=([^&]*)/); const sel = selM ? selM[1].split(',') : null;
    if (sel) stats.selectGets = (stats.selectGets || 0) + 1;
    const pick = o => { if (!sel) return o; for (const k of sel) if (!(k in o) && !k.startsWith('@')) { /* unknown names are not sent by the tool */ } const r = { '@odata.etag': o['@odata.etag'] }; for (const k of sel) if (k in o) r[k] = o[k]; return r; };
    const fl = /^(\w+)$/.test(pathOnly) && (qs.match(/\$filter=([^&]*)/) || [])[1];
    const fps = fl && /^Product eq '[^']*'( or Product eq '[^']*')*$/.test(fl) ? [...fl.matchAll(/Product eq '([^']*)'/g)].map(m => m[1]) : null;
    if (fps) {   // Set?$filter=Product eq '…' [or Product eq '…' …] -> all nodes of that type in these products
      stats.filterGets = (stats.filterGets || 0) + 1; stats.maxFilterProducts = Math.max(stats.maxFilterProducts || 0, fps.length);
      const t = TYPE_OF_SET[pathOnly]; if (!t) throw new ODataError(404, 'Entity set not found ' + pathOnly);
      const out = [];
      for (const id of fps) { const prod = store.get(id); const walk = n => { if (n.type === t) out.push(pick(serialize({ ...n, navs: {} }, prod))); Object.values(n.navs).forEach(v => (Array.isArray(v) ? v : [v]).forEach(walk)); }; if (prod) walk(prod); }
      return { status: 200, body: { value: out } };
    }
    if (/^(\w+)$/.test(pathOnly) && TYPE_OF_SET[pathOnly] && (fl || /\$top|\$count/.test(qs))) {   // collection query (Read from SAP: selection)
      stats.collectionGets = (stats.collectionGets || 0) + 1; stats.lastFilter = fl || ''; (stats.filters = stats.filters || []).push(pathOnly + ':' + (fl || ''));
      const t = TYPE_OF_SET[pathOnly], test = fl ? compileFilter(fl) : () => true; let out = [];
      for (const prod of store.values()) { const walk = n => { if (n.type === t) { const o = serialize({ ...n, navs: {} }, prod); if (test(o)) out.push(o); } Object.values(n.navs).forEach(v => (Array.isArray(v) ? v : [v]).forEach(walk)); }; walk(prod); }
      out.sort((a, b) => String(a.Product).localeCompare(String(b.Product)));
      const count = out.length, top = (qs.match(/\$top=(\d+)/) || [])[1];
      if (top !== undefined) out = out.slice(0, parseInt(top, 10));
      return { status: 200, body: Object.assign(/\$count=true/.test(qs) ? { '@odata.count': count } : {}, { value: out.map(pick) }) };
    }
    if (/\$expand=/.test(decodeURIComponent(p))) stats.expandGets = (stats.expandGets || 0) + 1;
    const { node, prod, nav } = resolve(pathOnly);
    const v = nav ? node.navs[nav] : node;
    return { status: 200, body: Array.isArray(v) ? { value: v.map(x => pick(serialize(x, prod))) } : pick(serialize(v, prod)) };
  }
  if (method === 'POST' && pathOnly === 'Product') {
    stats.post++;
    if (!body.ProductType) throw new ODataError(400, 'Enter a product type');
    if (!body.BaseISOUnit) throw new ODataError(400, 'Enter a base unit of measure');
    // DS4 (25 Sep 2026): no internal number assignment through API_PRODUCT_2
    // DS4 / SAP Community: API_PRODUCT_2 does not assign internal numbers ('Property PRODUCT is a key and cannot be initial')
    if (!body.Product) throw new ODataError(400, 'Property PRODUCT is a key and cannot be initial');
    const product = body.Product;
    if (store.has(product)) throw new ODataError(400, `Product ${product} already exists`);
    const prod = makeNode('Product_Type', { ...body, Product: product }, {});
    prod.data.BaseUnit = UNIT_SAP[prod.data.BaseISOUnit]; prod.data.LastChangeDateTime = stamp(); prod.data.CreatedByUser = 'TESTUSER';
    store.set(product, prod); return { status: 201, body: serialize(prod, prod) };
  }
  // DS4 (25 Sep 2026): modifying requests only on the canonical URL or one containment navigation from it
  const depth = pathOnly.split('/').length - 1;
  if ((method === 'PATCH' && depth > 0) || depth > 1) throw new ODataError(400, 'Resource path is supported only with containment navigation properties for this request type');
  const { node, prod, nav } = resolve(pathOnly);
  const im = headers['if-match'];
  if (method === 'POST') {
    stats.post++;
    if (!nav) throw new ODataError(405, 'POST only via navigation');
    const [, many] = T[node.type].navs[nav];
    if (!many) throw new ODataError(400, `${nav} exists already, use PATCH`);
    const c = addChild(node, nav, body); prod.data.LastChangeDateTime = stamp(); return { status: 201, body: serialize(c, prod) };
  }
  if (method === 'PATCH') {
    stats.patch++;
    if (!im) throw new ODataError(428, 'Precondition required: If-Match header missing');
    if (im !== '*' && im !== etagOf(prod)) { stats.preconditionFailed++; throw new ODataError(412, 'Precondition failed: the product was changed in the meantime'); }
    const target = nav ? node.navs[nav] : node;
    checkProps(target.type, body);
    for (const k of T[target.type].keys) if (k in body && String(body[k]) !== String(target.data[k])) throw new ODataError(400, `Key ${k} cannot be changed`);
    if (target.type === 'ProductValuation_Type' && body.Currency && target.data.Currency && body.Currency !== target.data.Currency)
      throw new ODataError(400, `Currency ${body.Currency} provided is incorrect for Product ${target.data.Product} Valuation ${target.data.ValuationArea}`);
    Object.assign(target.data, body); prod.data.LastChangeDateTime = stamp(); return { status: 200, body: serialize(target, prod) };
  }
  throw new ODataError(405, 'Method not allowed');
}
function errBody(e) { return { error: { code: 'MOCK/' + (e.status || 500), message: e.message, details: [] } }; }
function exec(method, p, body, headers) { try { return handle(method, p, body, headers); } catch (e) { return { status: e.status || 500, body: errBody(e) }; } }
function httpResp(r) { return `HTTP/1.1 ${r.status} X\r\nContent-Type: application/json\r\n\r\n${r.body ? JSON.stringify(r.body) : ''}\r\n`; }
function parseReq(part) {
  const at = part.search(/(GET|POST|PATCH|DELETE) /); const inner = part.substring(at);
  const [head, ...rest] = inner.split(/\r\n\r\n/); const lines = head.split('\r\n'); const [method, url] = lines[0].split(' ');
  const hdr = {}; lines.slice(1).forEach(l => { const i = l.indexOf(':'); if (i > 0) hdr[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); });
  const b = rest.join('\r\n\r\n').trim(); return { method, url, headers: hdr, body: b ? JSON.parse(b) : null };
}
function batch(text, boundary, prefer) {
  stats.batch++;
  const parts = text.split('--' + boundary).slice(1).filter(p => !p.startsWith('--') && p.trim());
  const ob = 'resp_' + Date.now(); let out = '';
  const contOnErr = /continue-on-error/.test(prefer || '');
  for (const part of parts) {
    const cm = part.match(/multipart\/mixed;\s*boundary=([^\s;]+)/i);
    let failed = false;
    if (cm) {
      stats.changesets++;
      const reqs = part.split('--' + cm[1]).slice(1).filter(p => !p.startsWith('--') && p.trim()).map(parseReq);
      const backup = structuredClone([...store.entries()]); const answers = [];
      for (const q of reqs) { const r = exec(q.method, q.url, q.body, q.headers); answers.push(r); if (r.status >= 300) { failed = true; break; } }
      if (failed) { store = new Map(backup); out += `--${ob}\r\nContent-Type: application/http\r\n\r\n` + httpResp(answers[answers.length - 1]); }
      else { const cb = 'cs_' + Math.random().toString(36).slice(2); out += `--${ob}\r\nContent-Type: multipart/mixed; boundary=${cb}\r\n\r\n` + answers.map(a => `--${cb}\r\nContent-Type: application/http\r\n\r\n` + httpResp(a)).join('') + `--${cb}--\r\n`; }
    } else {
      const q = parseReq(part); const r = exec(q.method, q.url, q.body, q.headers);
      out += `--${ob}\r\nContent-Type: application/http\r\n\r\n` + httpResp(r); failed = r.status >= 300;
    }
    if (failed && !contOnErr) break;
  }
  return { ct: `multipart/mixed; boundary=${ob}`, body: out + `--${ob}--\r\n` };
}
const server = http.createServer((req, res) => {
  let data = ''; req.on('data', c => data += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const send = (s, b, ct, h) => { res.writeHead(s, Object.assign({ 'Content-Type': ct || 'application/json' }, h || {})); res.end(b); };
    if (u.pathname === '/tool.html' || u.pathname === '/') return send(200, fs.readFileSync(TOOL), 'text/html');
    if (u.pathname === '/template_product.xml') return send(200, fs.readFileSync(path.join(__dirname, '../webapp/template_product.xml')), 'application/xml');
    if (u.pathname === '/sap/bc/ui2/start_up') return send(200, JSON.stringify({ id: 'TESTUSER', client: '410' }));
    if (u.pathname === '/__stats') return send(200, JSON.stringify({ ...stats, products: [...store.keys()] }));
    if (u.pathname === '/__product') return send(200, JSON.stringify(store.has(u.searchParams.get('id')) ? serialize(store.get(u.searchParams.get('id')), store.get(u.searchParams.get('id'))) : null));
    if (u.pathname === '/__reset') { store = new Map(); Object.keys(stats).forEach(k => stats[k] = 0); return send(200, '{}'); }
    // Custom ABAP service for the commodity code (MARC-STAWN), see docs/abap/README.md: the Product API has no such field.
    // Stored on the plant node as ZZ_STAWN (visible in /__product); moves the product's change timestamp like the BAPI does.
    if (u.pathname === '/sap/bc/zmm_matmass/stawn') {
      if (req.method !== 'POST') return send(405, '{"message":"POST only"}');
      stats.stawnPosts = (stats.stawnPosts || 0) + 1;
      let b; try { b = JSON.parse(data || '{}'); } catch (e) { return send(400, '{"message":"invalid JSON"}'); }
      const items = [];
      for (const it of (b.items || [])) {
        stats.stawnItems = (stats.stawnItems || 0) + 1;
        const prod = store.get(String(it.material));
        if (!prod) { items.push({ ...it, type: 'E', message: `Material ${it.material} does not exist` }); continue; }
        const plant = (prod.navs._ProductPlant || []).find(p => p.data.Plant === it.plant);
        if (!plant) { items.push({ ...it, type: 'E', message: `Material ${it.material} is not maintained in plant ${it.plant}` }); continue; }
        const code = (it.commodityCode || '').trim();
        if (!/^[0-9 ]{0,17}$/.test(code)) { items.push({ ...it, type: 'E', message: `Commodity code ${code} is not valid` }); continue; }
        const previous = plant.data.ZZ_STAWN || ''; const changed = previous !== code;
        if (changed) { plant.data.ZZ_STAWN = code; prod.data.LastChangeDateTime = stamp(); }
        items.push({ ...it, commodityCode: code, previous, changed, type: 'S', message: changed ? `Material ${it.material} changed` : 'unchanged' });
      }
      return send(200, JSON.stringify({ items }));
    }
    // V2 API_PRODUCT_SRV: only POST A_Product with internal number assignment (DS4, 28 Sep 2026: Product "" -> 201, number assigned)
    if (u.pathname.startsWith(SVC_V2)) {
      const rel2 = u.pathname.substring(SVC_V2.length);
      if (req.method === 'GET' && rel2 === '') return send(200, '{"d":{"EntitySets":["A_Product"]}}', 'application/json', { 'x-csrf-token': TOKEN_V2 });
      if (req.headers['x-csrf-token'] !== TOKEN_V2) return send(403, '{"error":{"message":{"value":"CSRF token validation failed"}}}', 'application/json', { 'x-csrf-token': 'Required' });
      if (req.method === 'POST' && rel2 === 'A_Product') {
        stats.v2post = (stats.v2post || 0) + 1;
        const b = JSON.parse(data); const iso = Object.keys(UNIT_SAP).find(k => UNIT_SAP[k] === b.BaseUnit);
        const v2err = m => send(400, JSON.stringify({ error: { code: 'MM/000', message: { lang: 'en', value: m } } }));
        if (b.Product !== '') return v2err('Mock expects internal numbering (Product "")');
        if (!iso) return v2err(`Unit ${b.BaseUnit} is not defined`);
        const product = String(4000000 + seq++);
        const prod = makeNode('Product_Type', { Product: product, ProductType: b.ProductType, IndustrySector: b.IndustrySector, BaseISOUnit: iso,
          _ProductDescription: ((b.to_Description || {}).results || []).map(x => ({ Product: product, Language: x.Language, ProductDescription: x.ProductDescription })) }, {});
        prod.data.BaseUnit = b.BaseUnit; prod.data.LastChangeDateTime = stamp(); prod.data.CreatedByUser = 'TESTUSER';
        store.set(product, prod);
        return send(201, JSON.stringify({ d: { Product: product, ProductType: b.ProductType, BaseUnit: b.BaseUnit } }));
      }
      return send(404, '{"error":{"message":{"value":"Resource not found"}}}');
    }
    if (!u.pathname.startsWith(SVC)) return send(404, JSON.stringify(errBody(new ODataError(404, 'No service'))));
    const rel = decodeURI(u.pathname.substring(SVC.length)) + (u.search || '');
    if (req.method === 'GET' && rel === '') return send(200, JSON.stringify({ value: [] }), 'application/json', { 'x-csrf-token': TOKEN });
    if (rel.startsWith('$metadata')) return send(200, metadata(), 'application/xml');
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== TOKEN) return send(403, JSON.stringify(errBody(new ODataError(403, 'CSRF token validation failed'))), 'application/json', { 'x-csrf-token': 'Required' });
    if (rel.startsWith('$batch')) { const b = (req.headers['content-type'].match(/boundary=([^;]+)/) || [])[1]; const r = batch(data, b, req.headers.prefer); return send(200, r.body, r.ct); }
    const r = exec(req.method, rel, data ? JSON.parse(data) : null, req.headers);
    send(r.status, r.status === 204 ? '' : JSON.stringify(r.body));
  });
});
server.listen(PORT, () => console.log('mock on ' + PORT));
