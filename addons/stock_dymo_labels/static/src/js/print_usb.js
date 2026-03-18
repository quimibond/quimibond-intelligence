/** @odoo-module **/
import { registry } from "@web/core/registry";

const printZplUsbAction = async (env, action) => {
    const { zpl_data, printer_name } = action.params;

    try {
        // 1. Conectar a QZ Tray (debe estar abierto en tu PC)
        if (!qz.websocket.isActive()) {
            await qz.websocket.connect();
        }

        // 2. Configurar la impresora local
        const config = qz.configs.create(printer_name);

        // 3. Enviar el string ZPL
        await qz.print(config, [zpl_data]);
        
        console.log("Impresión enviada a: " + printer_name);
    } catch (e) {
        alert("Error de impresión: Asegúrate de que QZ Tray esté ejecutándose y la impresora se llame " + printer_name);
        console.error(e);
    }
};

// Registramos la acción para que coincida con el 'tag' de Python
registry.category("actions").add("print_zpl_usb", printZplUsbAction);