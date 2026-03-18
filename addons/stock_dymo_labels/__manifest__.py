{
    'name': 'Etiquetas Dymo y Zebra Recepción MP',
    'version': '1.1',
    'category': 'Inventory',
    'author': 'CONSOLTI',
    'summary': 'Genera etiquetas Dymo (PDF) y Zebra (ZPL USB) desde la recepción',
    'depends': ['stock', 'web'], # Añadimos 'web' para el JS
    'data': [
        'reports/report_definition.xml',
        'reports/report_dymo_label.xml',
        'views/stock_picking_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'stock_dymo_labels/static/src/js/print_usb.js',
            # Asegúrate de incluir la librería qz-tray si no la cargas externamente
            'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js',
        ],
    },
    'installable': True,
    'license': 'LGPL-3',
}