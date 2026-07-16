// --------------- CONSTANTES ---------------
const TOKEN_CONFIG = Object.freeze({

    // Tempo de expiração do token
    EXPIRATION_DAYS: 30,

    // Tamho do token aleatório
    RANDOM_LENGTH: 32
});

// --------------- HELPERS ---------------

// Retorna a data atual
function getNow() {
    return new Date();
}

// Gera uma string aleatória
function generateRandom(length = TOKEN_CONFIG.RANDOM_LENGTH) {

    // Banco de dados de caracteres
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    // string vazia que recebe os caracteres sorteados
    let result = "";

    for (let i = 0; i < length; i++) {

        result += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );
    }

    return result;

}

// Gera um hash SHA-256 -> sequencia de dados criptografados de 256 bits
function generateHash(value) {
    const bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        value
    );

    return bytes.map(b => {
        const v = (b < 0) ? b + 256 : b;

        return ("0" + v.toString(16)).slice(-2);
    }).join("");
}

// Gera um token seguro
function generateToken(dealId) {
    const raw = [
        Utilities.getUuid(),
        dealId,
        Date.now(),
        generateRandom()
    ].join(("|"));

    return generateHash(raw);
}

// Cálcula a data de expiração
function getExpirationDate() {
    const date = new Date();

    date.setDate(
        date.getDate() + TOKEN_CONFIG.EXPIRATION_DAYS
    );

    return date;
}

// Verifica se um token expirou
function isExpired(expirationDate) {
    if (!expirationDate) {
        return true;
    }

    return new Date() > new Date(expirationDate);
}

// Monta o objeto que será salvo na planilha
function buildToneObject(options = {}) {
    return {
        token_id: Utilities.getUuid,
        token: options.token || "",
        deal_id: options.dealId || "",
        cliente_id: options.cliente_Id || "",
        folder_id: options.folderId || "",
        create_at: getNow(),
        expires_at: getExpirationDate(),
        last_access: "",
        access_count: 0,
        active: true,
        revoked: false,
        signature: generateHash(Utilities.getUuid())
    };
}

// --------------- TOKEN ---------------

// Cria um novo token de acesso
function createToken(options = {}) {
    if (!options.dealId) {
        throw new Error("TokenService.createToken(): dealId não informado")
    }

    const token = generateToken(options.dealId);

    const tokenObject = buildTokenObject({
        token: token,
        dealId: options.dealId,
        clientId: options.clientId,
        folderId: options.folderId
    });

    DatabaseService.insert(
        TOKEN_CONFIG.SHEETS.TOKENS,
        tokenObject
    );

    LoogerService.info({
        module: "TokenService",
        functionName: "createToken",
        action: "CREATE",
        description: "Token criado",
        dealId: options.dealId,
        payload: {
            token: token
        }
    });

    return tokenObject;

}

// Renova um token existente
function renewToken(token) {
    const record = DatabaseService.findFirst(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token
    );

    if (!record) {
        throw new Error("Token não encontrado");
    }

    const newToken = generationToken(record.deal_id);

    DatabaseService.updateWhere(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token,
        {
            token: newToken,
            created_at: getNow(),
            expires_at: getExpirationDate(),
            revoked: false,
            active: true
        }
    );

    LoggerService.info({
        module: "TokenService",
        functionName: "renewToken",
        action: "RENEW",
        description: "Token renovado",
        dealId: record.deal_id
    });

    return DatabaseService.findFirst(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        newToken
    );
}

// Revoga um token
function revokeToken(token) {
    const record = DatabaseService.findFirst(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token
    );

    if (!record) {
        return false;
    }

    DatabaseService.updateWhere(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token,
        {
            revoked: true,
            active: false
        }
    );

    LoggerService.security({
        module: "TokenService",
        functionName: "revokeToken",
        action: "REVOKE",
        description: "Token revogado",
        dealId: record.deal_id
    });

    return true;
}

// --------------- VALIDAÇÃO ---------------

// Valida um token
function validateToken(token) {
    const record = DatabaseService.findFirst(
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token
    );

    if (!record) {
        return null;
    }

    if (!record.active) {
        return null;
    }

    if (record.revoked) {
        return null;
    }

    if (isExpired(record.expires_at)) {
        return null;
    }

    DatabaseService.updateWhere (
        TOKEN_CONFIG.SHEETS.TOKENS,
        "token",
        token,
        {
            last_access: getNow(),
            access_count: Number(record.access_count || 0) + 1
        }
    );

    return record;
}

// Valida a assinatura de um token
function validateSignature(tokenObject) {
    if (!tokenObject) {
        return false;
    }

    if (!tokenObject.signature) {
        return false;
    }

    return tokenObject.signature.length === 64;
}

// Verifica se um token possui um acesso válido
function validateAccess(token) {
    const record = validateToken(token);

    if (!record) {
        return false;
    }

    if (!validateSignature(record)) {
        return false;
    }

    return true;
}