// Tipos MIME utilizados pelo sistema
const DRIVE_MIME = Object.freeze({

    // Identificador técnico usado pelo Google para sinalizar que um item esta em uma pasta no Drive
    FOLDER: "application/vnd.google-apps.folder",

    // Representação dos arquivos no sistma é feito a associação ao código identificador da internet
    PDF: MimeType.PDF,

    DOCUMENT: MimeType.GOOGLE_DOCS,

    SPREEDSHEAT: MimeType.GOOGLE_SHEETS,

    PRESENTATION: MimeType.GOOGLE_SLIDES,

    IMAGE_JPEG: MimeType.JPEG,

    IMAGE_PNG: MimeType.PNG

});

// Constantes de permissões ao Google Drive
const DRIVE_PERMISSION = Object.freeze({

    VIEW: DriveApp.Permission.VIEW,

    EDIT: DriveApp.Permission.EDIT,

    COMMENT: DriveApp.Permission.COMMENT

});

// Constantes de acesso ao Google Drive
const DRIVE_ACCESS = Object({

    PRIVATE: DriveApp.Access.PRIVATE,

    DOMAIN: DriveApp.Access.DOMAIN,

    ANYONE: DriveApp.Access.ANYONE,

    ANYONE_WITH_LINK: DriveApp.Access.ANYONE_WITH_LINK,

});

// ------------ HELPERS PRIVADOS ------------

// Retorna uma pasta pelo ID
function getFolder(folderId) {
    if (!folderId) {
        throw new Error("DriveService.getFolder(): FolderId não informado.")
    }

    try {
        return DriveApp.getFolder(folderId);
    } catch (e) {
        throw new Error(
            "Pasta não encontrada: " + folderId
        );
    }
}

// Retorna um arquivo pelo ID
function getFile(fileId) {
    if (!fileId) {
        throw new Error("DriveService.getFile(): FileId não informado.");
    }

    try {
        return DriveApp.getFileById(fileId);
    } catch (e) {
        throw new Error(
            "Arquivo não encontrado: " + fileId
        );
    }
}

// Verifica se uma pasta existe
function folderExists(folderId) {
    try {
        DriveApp.getFolderById(folderId);
        return true;
    } catch (e) {
        return false;
    }
}

// Verifica se um arquivo existe
function fileExists(fileId) {
    try {
        DriveApp.getFileById(fileId);
        return true;
    } catch (e) {
        return false;
    }
}

// Remove caracteres inválidos
function sanitizeName(value) {
    if (!value) {
        return "";
    }

    return String(value)
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ");
}

// Extrai o ID de uma URL dp Google Drive
function parseDriveId(value) {
    if (!value) {
        return "";
    }

    if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) {
        return value;
    }

    const match = String(value).match(/[-\w]{25,}/);

    return match ? match[0] : "";
}

// Retrona o MimeType de um arquivo
function getMimeType(file) {
    if (!file) {
        return "";
    }

    return file.getMimeType();
}

// Retorna a pasta pai
function getParentFolder(folder) {
    if (!folder) {
        return null;
    }

    const parents = folder.getParents();

    return parents.hasNext() ? parents.next() : null;

}

// Converte Folder em objeto
function buildFolderObject(folder) {

    return {

        id: folder.getId(),

        name: folder.getName(),

        url: folder.getUrl(),

        created: folder.getDateCreated(),

        owner: folder.getOwner() ? folder.getOwner().getEmail() : "",

        trashed: folder.isTrashed()
    };
}

// Converte em File em objeto
function buildFileObject(file) {

    return {

        id: file.getId(),

        name: file.getName(),

        url: file.getUrl(),

        mimeType: file.geMimeType(),

        size: file.getSize(),

        created: file.getDateCreated(),

        updated: file.getLastUpdated(),

        owner: file.getOwner() ? file.getOwner().getEmail() : "",

        trashed: file.isTrashed()

    };

}
