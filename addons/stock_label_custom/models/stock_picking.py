from odoo import models

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    def action_print_dymo_pdf(self):
        return self.env.ref('stock_label_custom.action_stock_label_custom_pdf').report_action(self)

    def action_print_dymo_zpl(self):
        # Llamamos directamente a tu reporte ZPL y enviamos a la impresora
        self.env['report.stock_label_custom.report_stock_label_custom_zpl']._get_report_values(self.move_line_ids.ids)
        return True
