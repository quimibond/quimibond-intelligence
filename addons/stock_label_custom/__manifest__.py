{
    'name': 'Stock Label Custom',
    'version': '1.0',
    'author': 'QUIMIBOND',
    'license': 'LGPL-3',
    'depends': ['stock'],
    'data': [
        'report/report.xml',
        'report/stock_label_custom_pdf.xml',
        'report/stock_label_custom_zpl.xml',
        # Vista con botones de impresión directa
        'views/stock_picking_form.xml',
    ],
    'installable': True,
    'application': False,
}
