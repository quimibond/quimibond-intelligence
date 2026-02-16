from odoo import models, _
from odoo.exceptions import UserError

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def action_print_dymo_labels(self):
        self.ensure_one()
        # Filtramos las líneas que tengan lote (lot_id)
        move_lines = self.move_line_ids.filtered(lambda l: l.lot_id)
        if not move_lines:
            raise UserError(_("No hay líneas con lote asignado para imprimir."))
            
        return self.env.ref('stock_dymo_labels.action_report_dymo_picking_label').report_action(move_lines)