from odoo import models, fields, api, _
from odoo.exceptions import UserError
import re

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    show_barcode_scan = fields.Boolean(compute='_compute_show_barcode_scan', store=False)
    barcode_scan_batch = fields.Char(string="Escanear Lote de Caja", copy=False)

    @api.depends('location_id', 'location_dest_id')
    def _compute_show_barcode_scan(self):
        for rec in self:
            loc_src = rec.location_id.complete_name or ''
            loc_dest = rec.location_dest_id.complete_name or ''
            r1 = '1 Materia Prima' in loc_src and '2 PRODUCCIÓN' in loc_dest
            r2 = '3 TEJIDO CIRCULAR EN PROCESO' in loc_src and '5 PRODUCTO EN PROCESO TEJIDO CIRCULAR' in loc_dest
            rec.show_barcode_scan = (r1 or r2) and rec.picking_type_code == 'internal'

    @api.onchange('barcode_scan_batch')
    def _onchange_barcode_scan_batch(self):
        if not self.barcode_scan_batch:
            return

        barcode = self.barcode_scan_batch
        self.barcode_scan_batch = False 

        # 1. Limpieza de caracteres (manejo de | y ])
        clean_search = re.sub(r'[^a-zA-Z0-9]', '', barcode)

        # 2. Buscar Lote
        lot = self.env['stock.lot'].search([('name', '=', barcode)], limit=1)
        if not lot:
            product_ids = self.move_ids.product_id.ids
            all_lots = self.env['stock.lot'].search([('product_id', 'in', product_ids)])
            for l in all_lots:
                if re.sub(r'[^a-zA-Z0-9]', '', l.name or '') == clean_search:
                    lot = l
                    break

        if not lot:
            raise UserError(_("Lote no encontrado: %s") % barcode)

        # --- NUEVA VALIDACIÓN DE DUPLICADOS ---
        # Revisamos si este lote ya fue agregado a las líneas de este picking
        existing_line = self.move_line_ids.filtered(lambda x: x.lot_id.id == lot.id)
        if existing_line:
            raise UserError(_("La caja con el lote %s ya ha sido escaneada y agregada al surtido.") % lot.name)
        # --------------------------------------

        # 3. Validar Stock en origen
        quant = self.env['stock.quant'].search([
            ('lot_id', '=', lot.id),
            ('location_id', '=', self.location_id.id),
            ('quantity', '>', 0)
        ], limit=1)

        if not quant:
            raise UserError(_("La caja %s no tiene existencias en %s.") % (lot.name, self.location_id.name))

        # 4. Crear registro real en la base de datos
        move = self.move_ids.filtered(lambda m: m.product_id == lot.product_id and m.state not in ['done', 'cancel'])[:1]
        
        if move:
            self.env['stock.move.line'].create({
                'picking_id': self._origin.id if self._origin else self.id,
                'move_id': move._origin.id if move._origin else move.id,
                'product_id': lot.product_id.id,
                'lot_id': lot.id,
                'quantity': quant.quantity,
                'location_id': self.location_id.id,
                'location_dest_id': self.location_dest_id.id,
                'product_uom_id': lot.product_id.uom_id.id,
            })
            
            return {'type': 'ir.actions.client', 'tag': 'reload'}
        else:
            raise UserError(_("El producto %s no es requerido en este documento.") % lot.product_id.display_name)