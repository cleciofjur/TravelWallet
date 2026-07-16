//  Serviço responsável pela leitura e pelo controle dos documentos do TravelWallet
//  armazenados no Google Drive.

const DriveService = (() => {
    const DRIVE_MIME = Object.freeze({
        FOLDER: "application/vnd.google-apps.folder",
        PDF: MimeType.PDF,
        DOCUMENT: MimeType.GOOGLE_DOCS,
        SPREADSHEET: MimeType.GOOGLE_SHEETS,
        PRESENTATION: MimeType.GOOGLE_SLIDES,
        IMAGE_JPEG: MimeType.JPEG,
        IMAGE_PNG: MimeType.PNG
    });

    const ACCEPTED_MIME_TYPES = Object.freeze([
        DRIVE_MIME.PDF,
        DRIVE_MIME.DOCUMENT,
        DRIVE_MIME.SPREADSHEET,
        DRIVE_MIME.PRESENTATION,
        DRIVE_MIME.IMAGE_JPEG,
        DRIVE_MIME.IMAGE_PNG
    ]);

    const DRIVE_PERMISSION = Object.freeze({
        VIEW: DriveApp.Permission.VIEW,
        EDIT: DriveApp.Permission.EDIT,
        COMMENT: DriveApp.Permission.COMMENT,
        NONE: DriveApp.Permission.NONE
    });

    const DRIVE_ACCESS = Object.freeze({
        PRIVATE: DriveApp.Access.PRIVATE,
        DOMAIN: DriveApp.Access.DOMAIN,
        DOMAIN_WITH_LINK: DriveApp.Access.DOMAIN_WITH_LINK,
        ANYONE: DriveApp.Access.ANYONE,
        ANYONE_WITH_LINK: DriveApp.Access.ANYONE_WITH_LINK
    });

    // -------------------- Helpers privados --------------------

    function requireValue(value, methodName, fieldName) {
        if (value === undefined || value === null || String(value).trim() === "") {
            throw new Error(
                `DriveService.${methodName}(): ${fieldName} não informado.`
            );
        }

        return String(value).trim();
    }

    function sanitizeName(value) {
        if (value === undefined || value === null) {
            return "";
        }

        return String(value)
            .trim()
            .replace(/[\\/:*?"<>|]/g, "-")
            .replace(/\s+/g, " ");
    }

    // Extrai ID e resource key de um ID puro ou de uma URL do Google Drive.
    function parseDriveReference(value, methodName) {
        const reference = requireValue(value, methodName, "ID ou URL");

        if (/^[a-zA-Z0-9_-]{20,}$/.test(reference)) {
            return { id: reference, resourceKey: "" };
        }

        const idPatterns = [
            /\/folders\/([a-zA-Z0-9_-]{20,})/i,
            /\/d\/([a-zA-Z0-9_-]{20,})/i,
            /[?&]id=([a-zA-Z0-9_-]{20,})/i
        ];

        let id = "";

        for (let index = 0; index < idPatterns.length; index++) {
            const match = reference.match(idPatterns[index]);

            if (match) {
                id = match[1];
                break;
            }
        }

        if (!id) {
            const fallback = reference.match(/[-\w]{20,}/);
            id = fallback ? fallback[0] : "";
        }

        if (!id) {
            throw new Error(
                `DriveService.${methodName}(): ID do Google Drive inválido.`
            );
        }

        const resourceKeyMatch = reference.match(/[?&]resourcekey=([^&#]+)/i);

        return {
            id,
            resourceKey: resourceKeyMatch
                ? decodeURIComponent(resourceKeyMatch[1])
                : ""
        };
    }

    function safeCall(callback, fallback = "") {
        try {
            const value = callback();
            return value === undefined || value === null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function serializeDate(value) {
        if (!value) {
            return "";
        }

        try {
            return value.toISOString();
        } catch (error) {
            return String(value);
        }
    }

    function enumName(value) {
        return value === undefined || value === null ? "" : String(value);
    }

    function getOwnerEmail(item) {
        return safeCall(() => {
            const owner = item.getOwner();
            return owner ? owner.getEmail() : "";
        });
    }

    function getParentInfo(item) {
        return safeCall(() => {
            const parents = item.getParents();

            if (!parents.hasNext()) {
                return { id: "", name: "", url: "" };
            }

            const parent = parents.next();

            return {
                id: parent.getId(),
                name: parent.getName(),
                url: parent.getUrl()
            };
        }, { id: "", name: "", url: "" });
    }

    function isFileObject(value) {
        return Boolean(
            value
            && typeof value.getId === "function"
            && typeof value.getMimeType === "function"
        );
    }

    function isFolderObject(value) {
        return Boolean(
            value
            && typeof value.getId === "function"
            && typeof value.getFiles === "function"
        );
    }

    function resolveFile(fileReference, methodName) {
        if (isFileObject(fileReference)) {
            return fileReference;
        }

        const reference = String(fileReference || "");

        return /^https?:\/\//i.test(reference)
            ? getFileByUrl(reference)
            : getFileById(reference);
    }

    function resolveFolder(folderReference, methodName) {
        if (isFolderObject(folderReference)) {
            return folderReference;
        }

        const reference = String(folderReference || "");

        return /^https?:\/\//i.test(reference)
            ? getFolderByUrl(reference)
            : getFolderById(reference);
    }

    function isAcceptedMimeType(mimeType) {
        return ACCEPTED_MIME_TYPES.indexOf(mimeType) !== -1;
    }

    function normalizeListOptions(options) {
        const source = options && typeof options === "object" ? options : {};

        return {
            recursive: source.recursive === true,
            includeTrashed: source.includeTrashed === true,
            acceptedOnly: source.acceptedOnly === true,
            visibleOnly: source.visibleOnly === true,
            mimeTypes: Array.isArray(source.mimeTypes) ? source.mimeTypes : [],
            sortBy: source.sortBy || "name",
            descending: source.descending === true
        };
    }

    function fileMatchesOptions(file, options) {
        const trashed = safeCall(() => file.isTrashed(), false);
        const mimeType = safeCall(() => file.getMimeType());

        if (!options.includeTrashed && trashed) {
            return false;
        }

        if (options.acceptedOnly && !isAcceptedMimeType(mimeType)) {
            return false;
        }

        if (options.visibleOnly && !isVisible(file)) {
            return false;
        }

        return !options.mimeTypes.length
            || options.mimeTypes.indexOf(mimeType) !== -1;
    }

    function collectFiles(folder, options, result) {
        const files = folder.getFiles();

        while (files.hasNext()) {
            const file = files.next();

            if (fileMatchesOptions(file, options)) {
                result.push(getFileInfo(file));
            }
        }

        if (!options.recursive) {
            return;
        }

        const folders = folder.getFolders();

        while (folders.hasNext()) {
            const childFolder = folders.next();

            if (options.includeTrashed || !safeCall(() => childFolder.isTrashed(), false)) {
                collectFiles(childFolder, options, result);
            }
        }
    }

    function sortFiles(files, options) {
        const allowedFields = ["name", "created", "updated", "size"];
        const field = allowedFields.indexOf(options.sortBy) !== -1
            ? options.sortBy
            : "name";
        const direction = options.descending ? -1 : 1;

        return files.sort((left, right) => {
            let a = left[field];
            let b = right[field];

            if (field === "name") {
                a = String(a || "").toLocaleLowerCase();
                b = String(b || "").toLocaleLowerCase();
            }

            if (a === b) return 0;
            return a > b ? direction : -direction;
        });
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;

        if (value === 0) return "0 B";

        const units = ["B", "KB", "MB", "GB", "TB", "PB"];
        const unitIndex = Math.min(
            Math.floor(Math.log(value) / Math.log(1024)),
            units.length - 1
        );
        const formatted = value / Math.pow(1024, unitIndex);

        return `${formatted.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
    }

    function validateEmail(email, methodName) {
        const normalized = requireValue(email, methodName, "E-mail")
            .toLocaleLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
            throw new Error(
                `DriveService.${methodName}(): e-mail inválido (${normalized}).`
            );
        }

        return normalized;
    }

    function resolveDriveItem(itemReference, methodName, itemType = "") {
        if (isFileObject(itemReference) || isFolderObject(itemReference)) {
            return itemReference;
        }

        const reference = requireValue(
            itemReference,
            methodName,
            "Arquivo ou pasta"
        );
        const normalizedType = String(itemType || "").toLocaleLowerCase();

        if (normalizedType === "file" || normalizedType === "arquivo") {
            return resolveFile(reference, methodName);
        }

        if (normalizedType === "folder" || normalizedType === "pasta") {
            return resolveFolder(reference, methodName);
        }

        if (/\/folders\//i.test(reference)) {
            return resolveFolder(reference, methodName);
        }

        if (/\/file\/|\/d\//i.test(reference)) {
            return resolveFile(reference, methodName);
        }

        try {
            return resolveFile(reference, methodName);
        } catch (fileError) {
            try {
                return resolveFolder(reference, methodName);
            } catch (folderError) {
                throw new Error(
                    `DriveService.${methodName}(): arquivo ou pasta não encontrado (${reference}).`
                );
            }
        }
    }

    function getItemInfo(item) {
        return isFolderObject(item)
            ? getFolderInfo(item)
            : getFileInfo(item);
    }

    function normalizePermission(permission, methodName) {
        if (
            permission === DRIVE_PERMISSION.VIEW
            || permission === DRIVE_PERMISSION.EDIT
            || permission === DRIVE_PERMISSION.COMMENT
        ) {
            return permission;
        }

        const key = String(permission || "VIEW").toLocaleUpperCase();

        if (!DRIVE_PERMISSION[key] || key === "NONE") {
            throw new Error(
                `DriveService.${methodName}(): permissão inválida (${key}).`
            );
        }

        return DRIVE_PERMISSION[key];
    }

    function normalizeAccess(access, methodName) {
        if (
            access === DRIVE_ACCESS.ANYONE
            || access === DRIVE_ACCESS.ANYONE_WITH_LINK
            || access === DRIVE_ACCESS.DOMAIN
            || access === DRIVE_ACCESS.DOMAIN_WITH_LINK
        ) {
            return access;
        }

        const key = String(access || "ANYONE_WITH_LINK").toLocaleUpperCase();

        if (!DRIVE_ACCESS[key] || key === "PRIVATE") {
            throw new Error(
                `DriveService.${methodName}(): tipo de acesso inválido (${key}).`
            );
        }

        return DRIVE_ACCESS[key];
    }

    function escapeDriveQueryValue(value) {
        return String(value)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'");
    }

    function normalizeSearchQuery(query, options, methodName) {
        const value = requireValue(query, methodName, "Pesquisa");
        const raw = options.rawQuery === true
            || /\s(?:contains|in)\s|\s*(?:=|!=|<=|>=|<|>)\s*/i.test(value);
        let driveQuery = raw
            ? value
            : `title contains '${escapeDriveQueryValue(value)}'`;

        if (!options.includeTrashed && !/\btrashed\b/i.test(driveQuery)) {
            driveQuery += " and trashed = false";
        }

        return driveQuery;
    }

    function iteratorToArray(iterator, mapper, limit) {
        const result = [];
        const maximum = Number(limit) > 0 ? Number(limit) : Infinity;

        while (iterator.hasNext() && result.length < maximum) {
            result.push(mapper(iterator.next()));
        }

        return result;
    }

    function summarizeLogValue(value) {
        if (isFileObject(value) || isFolderObject(value)) {
            return {
                id: safeCall(() => value.getId()),
                name: safeCall(() => value.getName())
            };
        }

        if (Array.isArray(value)) {
            return value.slice(0, 20).map(summarizeLogValue);
        }

        if (value && typeof value === "object") {
            const summary = {};

            Object.keys(value).slice(0, 30).forEach(key => {
                summary[key] = summarizeLogValue(value[key]);
            });

            return summary;
        }

        return value;
    }

    function callLogger(method, ...args) {
        try {
            if (
                typeof LoggerService !== "undefined"
                && LoggerService
                && typeof LoggerService[method] === "function"
            ) {
                return LoggerService[method].apply(LoggerService, args);
            }
        } catch (loggerError) {
            // Uma falha de log nunca deve interromper uma operação do Drive.
        }

        return null;
    }

    function withLogger(methodName, handler) {
        return function (...args) {
            const startedAt = Date.now();

            try {
                const result = handler.apply(null, args);

                callLogger("drive", {
                    functionName: methodName,
                    action: methodName
                        .replace(/([a-z])([A-Z])/g, "$1_$2")
                        .toLocaleUpperCase(),
                    description: `DriveService.${methodName} concluído.`,
                    executionTime: Date.now() - startedAt,
                    payload: {
                        arguments: summarizeLogValue(args),
                        result: summarizeLogValue(result)
                    }
                });

                return result;
            } catch (error) {
                callLogger("exception", error, {
                    module: "DriveService",
                    functionName: methodName,
                    action: `${methodName
                        .replace(/([a-z])([A-Z])/g, "$1_$2")
                        .toLocaleUpperCase()}_ERROR`,
                    executionTime: Date.now() - startedAt,
                    payload: {
                        arguments: summarizeLogValue(args)
                    }
                });

                throw error;
            }
        };
    }

    // -------------------- Pastas --------------------

    function getFolderById(folderId) {
        const reference = parseDriveReference(folderId, "getFolderById");

        try {
            return DriveApp.getFolderById(reference.id);
        } catch (error) {
            throw new Error(
                `DriveService.getFolderById(): pasta não encontrada ou sem acesso (${reference.id}).`
            );
        }
    }

    function getFolderByUrl(folderUrl) {
        const reference = parseDriveReference(folderUrl, "getFolderByUrl");

        try {
            if (
                reference.resourceKey
                && typeof DriveApp.getFolderByIdAndResourceKey === "function"
            ) {
                return DriveApp.getFolderByIdAndResourceKey(
                    reference.id,
                    reference.resourceKey
                );
            }

            return DriveApp.getFolderById(reference.id);
        } catch (error) {
            throw new Error(
                `DriveService.getFolderByUrl(): pasta não encontrada ou sem acesso (${reference.id}).`
            );
        }
    }

    function getFolderInfo(folderReference) {
        const folder = resolveFolder(folderReference, "getFolderInfo");
        const parent = getParentInfo(folder);

        return {
            id: folder.getId(),
            name: folder.getName(),
            safeName: sanitizeName(folder.getName()),
            url: folder.getUrl(),
            mimeType: DRIVE_MIME.FOLDER,
            description: safeCall(() => folder.getDescription()),
            created: serializeDate(safeCall(() => folder.getDateCreated(), null)),
            updated: serializeDate(safeCall(() => folder.getLastUpdated(), null)),
            owner: getOwnerEmail(folder),
            parentId: parent.id,
            parentName: parent.name,
            parentUrl: parent.url,
            sharingAccess: enumName(safeCall(() => folder.getSharingAccess())),
            sharingPermission: enumName(safeCall(() => folder.getSharingPermission())),
            trashed: safeCall(() => folder.isTrashed(), false)
        };
    }

    // -------------------- Arquivos --------------------

    function getFileById(fileId) {
        const reference = parseDriveReference(fileId, "getFileById");

        try {
            return DriveApp.getFileById(reference.id);
        } catch (error) {
            throw new Error(
                `DriveService.getFileById(): arquivo não encontrado ou sem acesso (${reference.id}).`
            );
        }
    }

    function getFileByUrl(fileUrl) {
        const reference = parseDriveReference(fileUrl, "getFileByUrl");

        try {
            if (
                reference.resourceKey
                && typeof DriveApp.getFileByIdAndResourceKey === "function"
            ) {
                return DriveApp.getFileByIdAndResourceKey(
                    reference.id,
                    reference.resourceKey
                );
            }

            return DriveApp.getFileById(reference.id);
        } catch (error) {
            throw new Error(
                `DriveService.getFileByUrl(): arquivo não encontrado ou sem acesso (${reference.id}).`
            );
        }
    }

    function getFileInfo(fileReference) {
        const file = resolveFile(fileReference, "getFileInfo");
        const parent = getParentInfo(file);
        const mimeType = file.getMimeType();
        const size = safeCall(() => file.getSize(), 0);

        return {
            id: file.getId(),
            name: file.getName(),
            safeName: sanitizeName(file.getName()),
            url: file.getUrl(),
            downloadUrl: safeCall(() => file.getDownloadUrl()),
            mimeType,
            size,
            sizeBytes: size,
            description: safeCall(() => file.getDescription()),
            created: serializeDate(safeCall(() => file.getDateCreated(), null)),
            updated: serializeDate(safeCall(() => file.getLastUpdated(), null)),
            owner: getOwnerEmail(file),
            parentId: parent.id,
            parentName: parent.name,
            parentUrl: parent.url,
            sharingAccess: enumName(safeCall(() => file.getSharingAccess())),
            sharingPermission: enumName(safeCall(() => file.getSharingPermission())),
            accepted: isAcceptedMimeType(mimeType),
            visible: isVisible(file),
            trashed: safeCall(() => file.isTrashed(), false)
        };
    }

    // -------------------- Listagem --------------------

    // Lista os arquivos de uma pasta.
    function listFiles(folderReference, options = {}) {
        const folder = resolveFolder(folderReference, "listFiles");
        const normalizedOptions = normalizeListOptions(options);
        const result = [];

        collectFiles(folder, normalizedOptions, result);

        return sortFiles(result, normalizedOptions);
    }

    function listAcceptedFiles(folderReference, options = {}) {
        return listFiles(folderReference, {
            ...options,
            acceptedOnly: true
        });
    }

    function listVisibleFiles(folderReference, options = {}) {
        return listFiles(folderReference, {
            ...options,
            visibleOnly: true
        });
    }

    // -------------------- Controle de visibilidade --------------------

    function archiveFile(fileReference) {
        const file = resolveFile(fileReference, "archiveFile");

        try {
            file.setTrashed(true);
            return getFileInfo(file);
        } catch (error) {
            throw new Error(
                `DriveService.archiveFile(): não foi possível arquivar o arquivo (${file.getId()}). ${error.message}`
            );
        }
    }

    function restoreFile(fileReference) {
        const file = resolveFile(fileReference, "restoreFile");

        try {
            file.setTrashed(false);
            return getFileInfo(file);
        } catch (error) {
            throw new Error(
                `DriveService.restoreFile(): não foi possível restaurar o arquivo (${file.getId()}). ${error.message}`
            );
        }
    }

    // Define se o arquivo pode ser acessado por qualquer pessoa que tenha o link.
    function setVisibility(fileReference, visible) {
        const file = resolveFile(fileReference, "setVisibility");

        if (typeof visible !== "boolean") {
            throw new Error(
                "DriveService.setVisibility(): visible deve ser true ou false."
            );
        }

        if (visible && safeCall(() => file.isTrashed(), false)) {
            throw new Error(
                "DriveService.setVisibility(): restaure o arquivo antes de torná-lo visível."
            );
        }

        try {
            if (visible) {
                file.setSharing(
                    DRIVE_ACCESS.ANYONE_WITH_LINK,
                    DRIVE_PERMISSION.VIEW
                );
            } else {
                file.setSharing(
                    DRIVE_ACCESS.ANYONE,
                    DRIVE_PERMISSION.NONE
                );
            }

            return getFileInfo(file);
        } catch (error) {
            throw new Error(
                `DriveService.setVisibility(): não foi possível alterar a visibilidade do arquivo (${file.getId()}). ${error.message}`
            );
        }
    }

    function isVisible(fileReference) {
        const file = resolveFile(fileReference, "isVisible");

        if (safeCall(() => file.isTrashed(), false)) {
            return false;
        }

        const access = safeCall(() => file.getSharingAccess(), DRIVE_ACCESS.PRIVATE);
        const permission = safeCall(
            () => file.getSharingPermission(),
            DRIVE_PERMISSION.NONE
        );

        return access !== DRIVE_ACCESS.PRIVATE
            && permission !== DRIVE_PERMISSION.NONE;
    }

    // -------------------- Compartilhamento --------------------

    // Cria um link compartilhável para um arquivo ou uma pasta.
    function createShareLink(itemReference, options = {}) {
        const normalizedOptions = typeof options === "string"
            ? { permission: options }
            : (options || {});
        const item = resolveDriveItem(
            itemReference,
            "createShareLink",
            normalizedOptions.type
        );
        const access = normalizeAccess(
            normalizedOptions.access,
            "createShareLink"
        );
        const permission = normalizePermission(
            normalizedOptions.permission,
            "createShareLink"
        );

        if (safeCall(() => item.isTrashed(), false)) {
            throw new Error(
                "DriveService.createShareLink(): não é possível compartilhar um item arquivado."
            );
        }

        try {
            item.setSharing(access, permission);
            const info = getItemInfo(item);

            return {
                ...info,
                shareUrl: item.getUrl(),
                sharingAccess: enumName(item.getSharingAccess()),
                sharingPermission: enumName(item.getSharingPermission())
            };
        } catch (error) {
            throw new Error(
                `DriveService.createShareLink(): não foi possível compartilhar o item. ${error.message}`
            );
        }
    }

    // Remove o acesso público ou a permissão de um usuário específico.
    function revokeShare(itemReference, email = "", options = {}) {
        let normalizedEmail = email;
        let normalizedOptions = options || {};

        if (email && typeof email === "object") {
            normalizedOptions = email;
            normalizedEmail = email.email || "";
        }

        const item = resolveDriveItem(
            itemReference,
            "revokeShare",
            normalizedOptions.type
        );

        try {
            if (normalizedEmail) {
                item.revokePermissions(
                    validateEmail(normalizedEmail, "revokeShare")
                );
            } else {
                item.setSharing(
                    DRIVE_ACCESS.ANYONE,
                    DRIVE_PERMISSION.NONE
                );
            }

            return getItemInfo(item);
        } catch (error) {
            throw new Error(
                `DriveService.revokeShare(): não foi possível revogar o compartilhamento. ${error.message}`
            );
        }
    }

    function setViewer(itemReference, email, options = {}) {
        const normalizedOptions = options || {};
        const normalizedEmail = validateEmail(email, "setViewer");
        const item = resolveDriveItem(
            itemReference,
            "setViewer",
            normalizedOptions.type
        );

        try {
            item.addViewer(normalizedEmail);

            return {
                ...getItemInfo(item),
                sharedWith: normalizedEmail,
                role: "VIEWER"
            };
        } catch (error) {
            throw new Error(
                `DriveService.setViewer(): não foi possível adicionar o visualizador (${normalizedEmail}). ${error.message}`
            );
        }
    }

    function setEditor(itemReference, email, options = {}) {
        const normalizedOptions = options || {};
        const normalizedEmail = validateEmail(email, "setEditor");
        const item = resolveDriveItem(
            itemReference,
            "setEditor",
            normalizedOptions.type
        );

        try {
            item.addEditor(normalizedEmail);

            return {
                ...getItemInfo(item),
                sharedWith: normalizedEmail,
                role: "EDITOR"
            };
        } catch (error) {
            throw new Error(
                `DriveService.setEditor(): não foi possível adicionar o editor (${normalizedEmail}). ${error.message}`
            );
        }
    }

    // -------------------- Pesquisa --------------------

    function searchFiles(query, options = {}) {
        const normalizedOptions = options || {};
        const driveQuery = normalizeSearchQuery(
            query,
            normalizedOptions,
            "searchFiles"
        );
        const iterator = normalizedOptions.folder
            ? resolveFolder(normalizedOptions.folder, "searchFiles")
                .searchFiles(driveQuery)
            : DriveApp.searchFiles(driveQuery);
        let result = iteratorToArray(
            iterator,
            file => getFileInfo(file),
            normalizedOptions.limit
        );

        if (normalizedOptions.acceptedOnly === true) {
            result = result.filter(file => file.accepted);
        }

        if (normalizedOptions.visibleOnly === true) {
            result = result.filter(file => file.visible);
        }

        return sortFiles(result, normalizeListOptions(normalizedOptions));
    }

    function searchFolders(query, options = {}) {
        const normalizedOptions = options || {};
        const driveQuery = normalizeSearchQuery(
            query,
            normalizedOptions,
            "searchFolders"
        );
        const iterator = normalizedOptions.folder
            ? resolveFolder(normalizedOptions.folder, "searchFolders")
                .searchFolders(driveQuery)
            : DriveApp.searchFolders(driveQuery);
        const result = iteratorToArray(
            iterator,
            folder => getFolderInfo(folder),
            normalizedOptions.limit
        );
        const direction = normalizedOptions.descending === true ? -1 : 1;

        return result.sort((left, right) => {
            const a = String(left.name || "").toLocaleLowerCase();
            const b = String(right.name || "").toLocaleLowerCase();

            if (a === b) return 0;
            return a > b ? direction : -direction;
        });
    }

    // -------------------- Informações --------------------

    function getStorageUsage() {
        const usedBytes = Number(DriveApp.getStorageUsed()) || 0;
        const limitBytes = Number(DriveApp.getStorageLimit()) || 0;
        const unlimited = limitBytes <= 0;
        const availableBytes = unlimited
            ? null
            : Math.max(limitBytes - usedBytes, 0);
        const usedPercent = unlimited
            ? null
            : Number(((usedBytes / limitBytes) * 100).toFixed(2));

        return {
            usedBytes,
            limitBytes,
            availableBytes,
            usedPercent,
            unlimited,
            used: formatBytes(usedBytes),
            limit: unlimited ? "Ilimitado" : formatBytes(limitBytes),
            available: unlimited ? "Ilimitado" : formatBytes(availableBytes)
        };
    }

    // -------------------- Sincronização --------------------

    function normalizeSyncOptions(options) {
        const source = options && typeof options === "object" ? options : {};

        return {
            recursive: source.recursive === true,
            acceptedOnly: source.acceptedOnly === true,
            overwrite: source.overwrite !== false,
            preserveVisibility: source.preserveVisibility !== false,
            dryRun: source.dryRun === true
        };
    }

    function findFileByName(folder, name) {
        if (!folder) return null;

        const files = folder.getFilesByName(name);

        while (files.hasNext()) {
            const file = files.next();

            if (!safeCall(() => file.isTrashed(), false)) {
                return file;
            }
        }

        return null;
    }

    function findFolderByName(folder, name) {
        if (!folder) return null;

        const folders = folder.getFoldersByName(name);

        while (folders.hasNext()) {
            const child = folders.next();

            if (!safeCall(() => child.isTrashed(), false)) {
                return child;
            }
        }

        return null;
    }

    function copySharingSettings(sourceFile, targetFile) {
        const access = safeCall(
            () => sourceFile.getSharingAccess(),
            DRIVE_ACCESS.PRIVATE
        );
        const permission = safeCall(
            () => sourceFile.getSharingPermission(),
            DRIVE_PERMISSION.NONE
        );

        if (
            access === DRIVE_ACCESS.PRIVATE
            || permission === DRIVE_PERMISSION.NONE
        ) {
            targetFile.setSharing(
                DRIVE_ACCESS.ANYONE,
                DRIVE_PERMISSION.NONE
            );
            return;
        }

        if (
            permission === DRIVE_PERMISSION.VIEW
            || permission === DRIVE_PERMISSION.EDIT
            || permission === DRIVE_PERMISSION.COMMENT
        ) {
            targetFile.setSharing(access, permission);
        }
    }

    function addSyncEvent(result, event) {
        result.items.push({
            timestamp: new Date().toISOString(),
            ...event
        });
    }

    function syncFilesInFolder(sourceFolder, targetFolder, path, options, result) {
        const files = sourceFolder.getFiles();

        while (files.hasNext()) {
            const sourceFile = files.next();
            const fileName = sourceFile.getName();
            const mimeType = sourceFile.getMimeType();

            if (safeCall(() => sourceFile.isTrashed(), false)) {
                result.skipped++;
                addSyncEvent(result, {
                    action: "SKIP_TRASHED",
                    path: `${path}/${fileName}`,
                    sourceId: sourceFile.getId()
                });
                continue;
            }

            if (options.acceptedOnly && !isAcceptedMimeType(mimeType)) {
                result.skipped++;
                addSyncEvent(result, {
                    action: "SKIP_MIME_TYPE",
                    path: `${path}/${fileName}`,
                    sourceId: sourceFile.getId(),
                    mimeType
                });
                continue;
            }

            try {
                const targetFile = findFileByName(targetFolder, fileName);
                const sourceUpdated = safeCall(
                    () => sourceFile.getLastUpdated().getTime(),
                    0
                );
                const targetUpdated = targetFile
                    ? safeCall(() => targetFile.getLastUpdated().getTime(), 0)
                    : 0;

                if (!targetFile) {
                    if (!options.dryRun) {
                        const copy = sourceFile.makeCopy(fileName, targetFolder);

                        if (options.preserveVisibility) {
                            safeCall(() => copySharingSettings(sourceFile, copy));
                        }
                    }

                    result.copied++;
                    addSyncEvent(result, {
                        action: options.dryRun ? "WOULD_COPY" : "COPIED",
                        path: `${path}/${fileName}`,
                        sourceId: sourceFile.getId()
                    });
                    continue;
                }

                if (!options.overwrite || sourceUpdated <= targetUpdated) {
                    result.skipped++;
                    addSyncEvent(result, {
                        action: "SKIP_UP_TO_DATE",
                        path: `${path}/${fileName}`,
                        sourceId: sourceFile.getId(),
                        targetId: targetFile.getId()
                    });
                    continue;
                }

                if (!options.dryRun) {
                    const copy = sourceFile.makeCopy(fileName, targetFolder);

                    if (options.preserveVisibility) {
                        safeCall(() => copySharingSettings(sourceFile, copy));
                    }

                    targetFile.setTrashed(true);
                }

                result.updated++;
                addSyncEvent(result, {
                    action: options.dryRun ? "WOULD_UPDATE" : "UPDATED",
                    path: `${path}/${fileName}`,
                    sourceId: sourceFile.getId(),
                    targetId: targetFile.getId()
                });
            } catch (error) {
                result.errors++;
                addSyncEvent(result, {
                    action: "ERROR",
                    path: `${path}/${fileName}`,
                    sourceId: sourceFile.getId(),
                    error: error.message
                });
            }
        }
    }

    function syncFolderTree(
        sourceFolder,
        targetFolder,
        path,
        options,
        result,
        targetRootId
    ) {
        syncFilesInFolder(sourceFolder, targetFolder, path, options, result);

        if (!options.recursive) return;

        const sourceFolders = sourceFolder.getFolders();

        while (sourceFolders.hasNext()) {
            const sourceChild = sourceFolders.next();

            if (
                safeCall(() => sourceChild.isTrashed(), false)
                || sourceChild.getId() === targetRootId
            ) {
                continue;
            }

            const childName = sourceChild.getName();
            let targetChild = findFolderByName(targetFolder, childName);

            if (!targetChild) {
                if (!options.dryRun && targetFolder) {
                    targetChild = targetFolder.createFolder(childName);
                }

                result.foldersCreated++;
                addSyncEvent(result, {
                    action: options.dryRun
                        ? "WOULD_CREATE_FOLDER"
                        : "CREATED_FOLDER",
                    path: `${path}/${childName}`,
                    sourceId: sourceChild.getId(),
                    targetId: targetChild ? targetChild.getId() : ""
                });
            }

            syncFolderTree(
                sourceChild,
                targetChild,
                `${path}/${childName}`,
                options,
                result,
                targetRootId
            );
        }
    }

    // Sincronização unidirecional: origem -> destino.
    function syncFolder(sourceReference, targetReference, options = {}) {
        const sourceFolder = resolveFolder(sourceReference, "syncFolder");
        const targetFolder = resolveFolder(targetReference, "syncFolder");

        if (sourceFolder.getId() === targetFolder.getId()) {
            throw new Error(
                "DriveService.syncFolder(): origem e destino devem ser pastas diferentes."
            );
        }

        const normalizedOptions = normalizeSyncOptions(options);
        const startedAt = new Date();
        const result = {
            source: getFolderInfo(sourceFolder),
            target: getFolderInfo(targetFolder),
            options: normalizedOptions,
            started: startedAt.toISOString(),
            completed: "",
            executionTime: 0,
            copied: 0,
            updated: 0,
            skipped: 0,
            foldersCreated: 0,
            errors: 0,
            items: []
        };

        syncFolderTree(
            sourceFolder,
            targetFolder,
            sourceFolder.getName(),
            normalizedOptions,
            result,
            targetFolder.getId()
        );

        const completedAt = new Date();
        result.completed = completedAt.toISOString();
        result.executionTime = completedAt.getTime() - startedAt.getTime();

        return result;
    }

    // Especialização para documentos de orçamento do CRM.
    function syncBudgetFolder(
        budgetFolderReference,
        targetFolderReference,
        options = {}
    ) {
        let sourceReference = budgetFolderReference;
        let targetReference = targetFolderReference;
        let normalizedInputOptions = options;

        if (
            budgetFolderReference
            && typeof budgetFolderReference === "object"
            && !isFolderObject(budgetFolderReference)
        ) {
            sourceReference = budgetFolderReference.sourceFolder
                || budgetFolderReference.sourceFolderId
                || budgetFolderReference.budgetFolder
                || budgetFolderReference.budgetFolderId;
            targetReference = targetFolderReference
                || budgetFolderReference.targetFolder
                || budgetFolderReference.targetFolderId;
            normalizedInputOptions = {
                ...budgetFolderReference.options,
                ...options
            };
        }

        const result = syncFolder(sourceReference, targetReference, {
            ...normalizedInputOptions,
            recursive: normalizedInputOptions.recursive !== false,
            acceptedOnly: true
        });

        return {
            ...result,
            syncType: "BUDGET"
        };
    }

    // -------------------- Return --------------------

    const publicMethods = {
        getFolderById,
        getFolderByUrl,
        getFolderInfo,
        getFileById,
        getFileByUrl,
        getFileInfo,
        listFiles,
        listAcceptedFiles,
        listVisibleFiles,
        archiveFile,
        restoreFile,
        setVisibility,
        isVisible,
        createShareLink,
        revokeShare,
        setViewer,
        setEditor,
        searchFiles,
        searchFolders,
        getStorageUsage,
        syncFolder,
        syncBudgetFolder
    };
    const loggedMethods = {};

    Object.keys(publicMethods).forEach(methodName => {
        loggedMethods[methodName] = withLogger(
            methodName,
            publicMethods[methodName]
        );
    });

    return Object.freeze({
        MIME: DRIVE_MIME,
        ACCEPTED_MIME_TYPES,
        ACCESS: DRIVE_ACCESS,
        PERMISSION: DRIVE_PERMISSION,
        ...loggedMethods
    });
})();
