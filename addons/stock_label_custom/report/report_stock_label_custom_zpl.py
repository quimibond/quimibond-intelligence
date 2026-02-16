# -*- coding: utf-8 -*-
from odoo import models

class ReportStockLabelCustomZPL(models.AbstractModel):
    _name = 'report.stock_label_custom.report_stock_label_custom_zpl'
    _description = 'Custom ZPL Label Report'

    def _get_report_values(self, docids, data=None):
        print("DEBUG ZPL REPORT CALLED", docids)
        docs = self.env['stock.move.line'].browse(docids)
        res = []
        for line in docs:
            lot = line.lot_id
            res.append({
                'name': lot.name or '',
                'product_code': line.product_id.default_code or '',
                'product_name': line.product_id.name or '',
                'product_qty': line.product_qty or 0,
                'caja': (lot.name or '')[-4:],
            })
        print("DEBUG DOCS:", res)    
        return {
            'doc_ids': docids,
            'doc_model': 'stock.move.line',
            'docs': res,
        }
