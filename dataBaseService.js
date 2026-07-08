const DatabaseService = (() => {

    let spreadsheet = null;

    const sheetCache = {};
    const headerCache = {};
    const dataCache = {};
    const columnIndexCache = {};

    function getDatabase() {
        if (spreadsheet) return spreadsheet;
        spreadsheet = SpreadsheetApp.openById(CONFIG.DATABASE_TRAVELWALLET);
        return spreadsheet;
    }

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

    function validateSheet(sheetName) {
        try {
            getSheet(sheetName);
            return true;
        } catch (e) {
            Logger.log(e);
            return false;
        }
    }

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

    function getColumnIndexes(sheetName) {
        if (columnIndexCache[sheetName]) return columnIndexCache[sheetName];

        const headers = getHeaders(sheetName);

        const indexes = {};

        headers.forEach((h, i) => indexes[h] = i);

        columnIndexCache[sheetName] = indexes;

        return indexes;
    }

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

    function rowToObject(headers, row) {
        const obj = {};

        headers.forEach((header, index) => {
            obj[header] = row[index] !== undefined ? row[index] : "";
        });

        return obj;
    }

    function objectToRow(headers, obj) {
        return headers.map(header =>
            Object.prototype.hasOwnProperty.call(obj, header)
                ? obj[header]
                : ""
        );
    }

    function getAll(sheetName) {
        const headers = getHeaders(sheetName);
        return getRangeValues(sheetName).map(r => rowToObject(headers, r));
    }

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

    function exists(sheetName, field, value) {
        return findFirst(sheetName, field, value) !== null;
    }

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
        count
    };

})();
