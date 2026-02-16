# -*- coding: utf-8 -*-
import socket
from odoo import models, _
from odoo.exceptions import UserError

class ReportStockLabelCustomZPL(models.AbstractModel):
    _name = 'report.stock_label_custom.report_stock_label_custom_zpl'
    _description = 'Custom ZPL Label Report'

    def _get_report_values(self, docids, data=None):
        docs = self.env['stock.move.line'].browse(docids)
        res = []
        for line in docs:
            lot = line.lot_id
            res.append({
                'name': lot.name or '',
                'product_code': line.product_id.default_code or '',
                'product_name': line.product_id.name or '',
                'product_qty': line.qty_done or 0,
                'caja': (lot.name or '')[-4:],
            })

        # Renderizamos el template QWeb para obtener el ZPL completo
        zpl_string = self.env['ir.qweb']._render(
            'stock_label_custom.report_stock_label_custom_zpl',
            {'docs': res}
        )

        # Enviamos el ZPL directamente a la impresora Zebra
        self._send_to_printer('192.168.1.15', 9100, zpl_string)

        return {
            'doc_ids': docids,
            'doc_model': 'stock.move.line',
            'docs': res,
        }

    def _send_to_printer(self, ip, port, zpl_data):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect((ip, port))
            s.sendall(zpl_data.encode('utf-8'))
            s.close()
        except Exception as e:
            raise UserError(_("Error enviando a impresora: %s") % e)
