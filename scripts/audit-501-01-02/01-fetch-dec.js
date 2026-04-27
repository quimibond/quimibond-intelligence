// Pull all Dec 2025 done stock moves into JSON for offline analysis.
const fs = require('fs');
const path = require('path');
const { fetchAll } = require('./lib.js');

const FIELDS = [
  'odoo_move_id','product_id','product_ref','product_uom_qty','quantity',
  'state','date','location_id','location_dest_id','location_usage','location_dest_usage',
  'reference','origin','is_inventory','value','price_unit','has_account_move',
  'account_move_ids','is_in','is_out','is_dropship','production_id','raw_material_production_id',
  'picking_name'
].join(',');

(async () => {
  const base = `/rest/v1/odoo_stock_moves?select=${FIELDS}&date=gte.2025-12-01&date=lt.2026-01-01&state=eq.done&order=odoo_move_id.asc`;
  const rows = await fetchAll(base, { pageSize: 1000, maxPages: 60 });
  const out = path.join(__dirname, 'dec2025_moves.json');
  fs.writeFileSync(out, JSON.stringify(rows));
  console.log('rows', rows.length, '->', out);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
