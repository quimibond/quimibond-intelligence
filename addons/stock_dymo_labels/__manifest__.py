{
    'name': 'Etiquetas Dymo Recepción MP',
    'version': '1.0',
    'category': 'Inventory',
    'summary': 'Genera etiquetas Dymo desde la recepción de mercancía',
    'depends': ['stock'],
    'data': [
        'reports/report_definition.xml',
        'reports/report_dymo_label.xml',
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}