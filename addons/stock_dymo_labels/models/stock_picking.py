from odoo import models, fields, api, _, exceptions

class StockPicking(models.Model):
    _inherit = 'stock.picking'

    # MÉTODO 1: Impresión original a PDF (Dymo)
    def action_print_dymo_labels(self):
        self.ensure_one()
        move_lines = self.move_line_ids.filtered(lambda l: l.lot_id)
        if not move_lines:
            raise exceptions.UserError(_("No hay líneas con lote asignado para imprimir."))
            
        return self.env.ref('stock_dymo_labels.action_report_dymo_picking_label').report_action(move_lines)

    # MÉTODO 2: Impresión Directa ZPL (Zebra via Action Client)
    def action_print_zebra_zpl(self):
        self.ensure_one()
        move_lines = self.move_line_ids.filtered(lambda l: l.lot_id)
        if not move_lines:
            return {
                'type': 'ir.actions.client',
                'tag': 'display_notification',
                'params': {
                    'title': _('Atención'),
                    'message': _('No hay líneas con lote asignado.'),
                    'sticky': False,
                }
            }

        zpl_body = ""
        for line in move_lines:
            ref = line.product_id.default_code or "N/A"
            name = line.product_id.name[:45]
            lot = line.lot_id.name or ""
            qty = int(line.quantity)
            box_no = lot[-4:] if lot else "0000"

            zpl_body += f"""
^XA^CI28
^CF0,50,50^FO50,50^FDREF: {ref}^FS
^CF0,40,40^FO50,110^FB700,2,0,C^FD{name}^FS
^CF0,40,40^FO50,210^FDLote: {lot}^FS
^FO500,210^FDCant: {qty}^FS
^FO50,270^FDN. CAJA: {box_no}^FS
^FO120,350^BY3^BCN,120,Y,N,N^FD{lot}^FS
^XZ"""

        return {
            'type': 'ir.actions.client',
            'tag': 'print_zpl_usb',
            'params': {
                'zpl_data': zpl_body,
                'printer_name': 'ZD230',
            }
        }