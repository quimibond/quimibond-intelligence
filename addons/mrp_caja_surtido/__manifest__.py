{
    'name': 'Surtido de Componentes por Lote Cerrado (Textil)',
    'version': '19.0.1.0.0',
    'category': 'Inventory/Inventory',
    'summary': 'Surtido de hilos por lotes completos desde el Albarán',
    'author': 'CONSOLTI',
    'depends': ['stock', 'mrp'],
    'data': [
        'security/ir.model.access.csv',
        'views/stock_picking_views.xml',
    ],
    'installable': True,
    'license': 'LGPL-3',
}