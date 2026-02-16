from odoo import models, api

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def action_print_dymo_labels(self):
        """ 
        Acción para imprimir etiquetas de las líneas de movimiento 
        que tengan un número de lote asignado.
        """
        self.ensure_one()
        # Obtenemos las líneas de movimiento (move_line_ids) que tienen lote
        move_lines = self.move_line_ids.filtered(lambda l: l.lot_id)
        if not move_lines:
            # Opcional: Podrías lanzar una excepción si no hay lotes
            return False
            
        return self.env.ref('stock_dymo_labels.action_report_dymo_picking_label').report_action(move_lines)