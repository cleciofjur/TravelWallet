// Serviço responsável por toda a persistência de dados e interação com o SpreadsheetApp.

const DatabaseService = (() => {

    let spreadsheet = null;

    const sheetCache = {};
    const headerCache = {};
    const dataCache = {};
    const columnIndexCache = {};

    // Obtém a instância da planilha (Spreadsheet).
    function getDatabase() {
        if (spreadsheet) return spreadsheet;
        // Certifique-se de que CONFIG.DATABASE_TRAVELWALLET está definido no escopo global
        spreadsheet = SpreadsheetApp.openById(CONFIG.DATABASE_TRAVELWALLET);
        return spreadsheet;
    }

    // Limpa o cache para evitar o uso de dados obsoletos.
    function clearCache(sheetName) {
        if (sheetName) {
            delete dataCache[sheetName];
            delete headerCache[sheetName];
            delete columnIndexCache[sheetName];
            delete sheetCache[sheetName];
        } else {
            for (const key in dataCache) delete dataCache[key];
            for (const key in headerCache) delete headerCache[key];
            for (const key in columnIndexCache) delete columnIndexCache[key];
            for (const key in sheetCache) delete sheetCache[key];
        }
    }

    function refresh(sheetName) {
        clearCache(sheetName);
    }

    // Obtém uma aba (Sheet) pelo nome, utilizando cache em memória.
    function getSheet(sheetName) {
        if (!sheetName) {
            throw new Error("DatabaseService.getSheet(): Nome da aba não informado.");
        }
        if (sheetCache[sheetName]) return sheetCache[sheetName];

        const sheet = getDatabase().getSheetByName(sheetName);
        if (!sheet) {
            throw new Error(`A aba "${sheetName}" não existe.`);
        }

        sheetCache[sheetName] = sheet;
        return sheet;
    }

    // Valida se uma determinada aba existe.
    function validateSheet(sheetName) {
        try {
            getSheet(sheetName);
            return true;
        } catch (e) {
            Logger.log(e);
            return false;
        }
    }

    // Normaliza um array de cabeçalhos (remove acentos, espaços extras e converte para minúsculas).
    function normalizeHeaders(headers) {
        return headers.map(h =>
            String(h)
                .trim()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\w\s]/g, "")
                .replace(/\s+/g, "_")
                .toLowerCase()
        );
    }

    // Obtém os cabeçalhos normalizados da aba.
    function getHeaders(sheetName) {
        if (!sheetName) {
            throw new Error("DatabaseService.getHeaders(): nome da aba não informado.");
        }
        if (headerCache[sheetName]) return headerCache[sheetName];

        const sheet = getSheet(sheetName);
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        const normalizedHeaders = normalizeHeaders(headers);
        headerCache[sheetName] = normalizedHeaders;
        return normalizedHeaders;
    }

    // Mapeia os índices de cada coluna baseado em seus cabeçalhos.
    function getColumnIndexes(sheetName) {
        if (columnIndexCache[sheetName]) return columnIndexCache[sheetName];

        const headers = getHeaders(sheetName);
        const indexes = {};
        headers.forEach((h, i) => indexes[h] = i);
        columnIndexCache[sheetName] = indexes;
        return indexes;
    }

    // Lê todos os dados de uma aba (ignorando o cabeçalho) e faz cache dos valores.
    function getRangeValues(sheetName) {
        if (!sheetName) {
            throw new Error("DatabaseService.getRangeValues(): nome da aba não informado.");
        }
        if (dataCache[sheetName]) return dataCache[sheetName];

        const sheet = getSheet(sheetName);
        if (sheet.getLastRow() <= 1) {
            dataCache[sheetName] = [];
            return [];
        }

        const values = sheet.getRange(
            2,
            1,
            sheet.getLastRow() - 1,
            sheet.getLastColumn()
        ).getValues();

        dataCache[sheetName] = values;
        return values;
    }

    // Converte um array correspondente a uma linha em um objeto com chaves correspondentes aos cabeçalhos.
    function rowToObject(headers, row) {
        const obj = {};
        headers.forEach((header, index) => {
            obj[header] = row[index] !== undefined ? row[index] : "";
        });
        return obj;
    }

    // Converte um objeto em um array representando uma linha da planilha para escrita.
    function objectToRow(headers, obj) {
        return headers.map(header =>
            Object.prototype.hasOwnProperty.call(obj, header)
                ? obj[header]
                : ""
        );
    }

    // Busca todos os registros de uma aba como objetos.
    function getAll(sheetName) {
        const headers = getHeaders(sheetName);
        return getRangeValues(sheetName).map(r => rowToObject(headers, r));
    }

    function list(sheetName) {
        return getAll(sheetName);
    }

    // Retorna a quantidade total de registros. Se campo e valor forem fornecidos, conta condicionalmente.
    function count(sheetName, field = null, value = null) {
        const values = getRangeValues(sheetName);
        if (!field) return values.length;

        const indexes = getColumnIndexes(sheetName);
        const columnIndex = indexes[field];
        if (columnIndex === undefined) {
            throw new Error(`Campo "${field}" inexistente.`);
        }

        let total = 0;
        for (const row of values) {
            if (row[columnIndex] === value) {
                total++;
            }
        }
        return total;
    }

    // Retorna a quantidade total de registros.
    function countAll(sheetName) {
        return count(sheetName);
    }

    // Retorna o primeiro objeto encontrado onde a coluna "field" equivale a "value".
    function findFirst(sheetName, field, value) {
        const headers = getHeaders(sheetName);
        const indexes = getColumnIndexes(sheetName);
        const columnIndex = indexes[field];

        if (columnIndex === undefined) {
            throw new Error(`Campo "${field}" inexistente.`);
        }

        for (const row of getRangeValues(sheetName)) {
            if (row[columnIndex] === value) {
                return rowToObject(headers, row);
            }
        }
        return null;
    }

    function findById(sheetName, idField, id) {
        return findFirst(sheetName, idField, id);
    }

    function findBy(sheetName, filters) {
        const headers = getHeaders(sheetName);

        const indexes = getColumnIndexes(sheetName);

        return getRangeValues(sheetName).filter(row => {
            return Object.keys(filters).every(field => {
                const index = indexes[field];

                return row[index] === filters[field];
            });
        }).map(row => rowToObject(headers, row));
    }

    // Retorna todos os objetos onde a coluna "field" equivale a "value".
    function findAll(sheetName, field, value) {
        const headers = getHeaders(sheetName);
        const indexes = getColumnIndexes(sheetName);
        const columnIndex = indexes[field];

        if (columnIndex === undefined) {
            throw new Error(`Campo "${field}" inexistente.`);
        }

        const result = [];
        for (const row of getRangeValues(sheetName)) {
            if (row[columnIndex] === value) {
                result.push(rowToObject(headers, row));
            }
        }
        return result;
    }

    // Checa se um registro existe com determinado valor de um campo.
    function exists(sheetName, field, value) {
        return findFirst(sheetName, field, value) !== null;
    }

    function existsById(sheetName, idField, id) {
        return exists(sheetName, idField, id);
    }

    // Insere um novo registro de forma segura, gerenciando Locks e esvaziando o cache.
    function insert(sheetName, object) {
        const lock = LockService.getScriptLock();
        lock.waitLock(10000);

        try {
            const headers = getHeaders(sheetName);
            const row = objectToRow(headers, object);
            const sheet = getSheet(sheetName);

            sheet.appendRow(row);
            clearCache(sheetName);

            return object;
        } finally {
            lock.releaseLock();
        }
    }

    // Atualiza um registro existente identificando-o pelo campo chave. Modifica apenas os campos presentes em `data`.
    function update(sheetName, keyField, keyValue, data) {
        const lock = LockService.getScriptLock();
        lock.waitLock(10000);

        try {
            const headers = getHeaders(sheetName);
            const indexes = getColumnIndexes(sheetName);
            const keyIndex = indexes[keyField];

            if (keyIndex === undefined) {
                throw new Error(`Campo chave "${keyField}" inexistente.`);
            }

            const values = getRangeValues(sheetName);
            let rowIndex = -1;
            let existingRowData = null;

            // Busca do índice (row da planilha) ignorando o header (+2 para compensar index 0 da array e do header na Sheet)
            for (let i = 0; i < values.length; i++) {
                if (values[i][keyIndex] === keyValue) {
                    rowIndex = i + 2;
                    existingRowData = values[i];
                    break;
                }
            }

            if (rowIndex === -1) return false;

            const existingObj = rowToObject(headers, existingRowData);

            // Mescla dados atuais com novas propriedades do 'data' a atualizar
            const updatedObj = { ...existingObj, ...data };
            const newRowData = objectToRow(headers, updatedObj);

            const sheet = getSheet(sheetName);
            sheet.getRange(rowIndex, 1, 1, headers.length).setValues([newRowData]);

            clearCache(sheetName);
            return true;
        } finally {
            lock.releaseLock();
        }
    }

    // Remove fisicamente um registro da planilha pela chave correspondente.
    function deleteRecord(sheetName, keyField, keyValue) {
        const lock = LockService.getScriptLock();
        lock.waitLock(10000);

        try {
            const indexes = getColumnIndexes(sheetName);
            const keyIndex = indexes[keyField];

            if (keyIndex === undefined) {
                throw new Error(`Campo chave "${keyField}" inexistente.`);
            }

            const values = getRangeValues(sheetName);
            let rowIndex = -1;

            for (let i = 0; i < values.length; i++) {
                if (values[i][keyIndex] === keyValue) {
                    rowIndex = i + 2;
                    break;
                }
            }

            if (rowIndex === -1) return false;

            const sheet = getSheet(sheetName);
            sheet.deleteRow(rowIndex);

            clearCache(sheetName);
            return true;
        } finally {
            lock.releaseLock();
        }
    }

    // Função que insere varios registros de uma única vez
    function insertMany(sheetName, objects) {

        if (!Array.isArray(objects) || objects.length === 0) {
            return;
        }

        const lock = LockService.getScriptLock();
        lock.waitLock(10000);

        try {
            const headers = getHeaders(sheetName);
            const rows = objects.map(obj => objectToRow(headers, obj));
            const sheet = getSheet(sheetName);
            const startRow = sheet.getLastRow() + 1;

            sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);

            clearCache(sheetName);
        } finally {
            lock.releaseLock();
        }
    }

    // Atualiza vários registros
    function updateMany(sheetName, keyField, records) {
        records.forEach(record => {
            update(
                sheetName,
                keyField,
                record[keyField],
                record
            );
        });
    }

    // Insere ou atualiza um registro
    function upsert(sheetName, keyField, object) {

        const keyValue = object[keyField];

        if (exists(sheetName, keyField, keyValue)) {
            update(
                sheetName,
                keyField,
                keyValue,
                object
            );
        } else {
            insert(
                sheetName,
                object
            );
        }
    }

    function upsertMany(sheetName, keyField, objects) {
        objects.forEach(obj => {
            upsert(
                sheetName,
                keyField,
                obj
            );
        });
    }

    // Retorna a linha da planilha
    function getRowNumber(sheetName, field, value) {
        const indexes = getColumnIndexes(sheetName);

        const columnIndex = indexes[field];

        const values = getRangeValues(sheetName);

        for (let i = 0; i < values.length; i++) {
            if (values[i][columnIndex] === value) {
                return i + 2;
            }
        }

        return -1;

    }

    function truncate(sheetName) {
        const sheet = getSheet(sheetName);

        if (sheet.getLastRow() > 1) {
            sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        }

        clearCache(sheetName);
    }

    return {
        getDatabase,
        getSheet,
        validateSheet,
        normalizeHeaders,
        getHeaders,
        getColumnIndexes,
        getRangeValues,
        rowToObject,
        objectToRow,
        getAll,
        findFirst,
        findAll,
        exists,
        count,
        clearCache,
        refresh,
        insert,
        update,
        deleteRecord,
        findById,
        existsById,
        list,
        countAll,
        insertMany,
        updateMany,
        upsert,
        upsertMany,
        findBy,
        getRowNumber,
        truncate
    };

})();