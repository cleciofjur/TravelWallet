// Arquivo responsável por toda comunicação com o Google Sheets.

const DatabaseService = (() => {

    // Variável que armazena a instância da planilha, evitando abrir diversas vezes durante a mesma execução.
    let spreadsheet = null;

    // Cache das abas da planilha, evitando buscas repetidas.
    const sheetCache = {};

    function getDatabase() {

        // Se a planilha já estiver carregada, retorna imediatamente.
        if (spreadsheet) {
            return spreadsheet;
        }

        // Abre a planilha utilizando o ID definido no arquivo Config.gs.
        spreadsheet = SpreadsheetApp.openById(CONFIG.DATABASE_TRAVELWALLET);

        return spreadsheet;
    }
    
    // Retorna uma aba da planilha.
    function getSheet(sheetName) {

        if (!sheetName) {
            throw new Error(
                "DatabaseService.getSheet(): Nome da aba não informado."
            );
        }

        // Verifica se a aba já foi carregada anteriormente.
        if (sheetCache[sheetName]) {
            return sheetCache[sheetName];
        }

        // Busca a aba na planilha.
        const sheet = getDatabase().getSheetByName(sheetName);

        // Caso não exista, lança um erro.
        if (!sheet) {
            throw new Error(
                `A aba "${sheetName}" não existe.`
            );
        }

        // Armazena a aba no cache para reutilização.
        sheetCache[sheetName] = sheet;

        return sheet;
    }

    // Verifica se uma aba existe na planilha
    function validateSheet(sheetName) {

        try {

            getSheet(sheetName);

            return true;

        } catch (error) {

            Logger.log(error);

            return false;
        }
    }

    // Expõe apenas as funções públicas do serviço.
    return {

        getDatabase,

        getSheet,

        validateSheet

    };

})();