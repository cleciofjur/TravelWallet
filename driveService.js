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

    // -------------------- Exportação --------------------

    return Object.freeze({
        MIME: DRIVE_MIME,
        ACCEPTED_MIME_TYPES,
        ACCESS: DRIVE_ACCESS,
        PERMISSION: DRIVE_PERMISSION,
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
        isVisible
    });
})();
