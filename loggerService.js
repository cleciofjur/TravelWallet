const LOG_LEVEL = Object.freeze({
    DEBUG: "DEBUG",
    INFO: "INFO",
    WARNING: "WARNING",
    ERROR: "ERROR",
    SECURITY: "SECURITY"
});

// Gera um identificador único para o log
function generateId() {
    return Utilities.getUuid();
}

// Serialização de qualquer objeto para JSON
function serialize(value) {
    if (value === undefined || value === null) {
        return "";
    }

    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
}

// Remove informações sensíveis do payload antes de gravar na planilha
function sanitizePayload(payload) {
    if (!payload) {
        return null;
    }

    let copy;

    try {
        copy = JSON.parse(JSON.stringify(payload));
    } catch (e) {
        return payload;
    }

    const sensitiveFields = [
        "password",
        "senha",
        "token",
        "authorization",
        "access_token",
        "refresh_token",
        "api_key",
        "secret",
        "client_secret"
    ];

    function clean(obj) {
        if (!obj || typeof obj !== "object") {
            return;
        }

        Object.keys(obj).forEach(key => {
            const lower = key.toLocaleLowerCase();

            if (sensitiveFields.includes(lower)) {
                obj[key] = "***";
            } else {
                clean(obj[key]);
            }
        });
    }

    clean(copy);

    return copy;
}

// Obtém o usuário da execução
function getUser() {
    try {
        return Session.getActiveUser.getEmail() || "";
    } catch (e) {
        return "";
    }
}

// Retorna o timestamp atual
function now() {
    return new Date();
}

// Cria o objeto padrão que será gravado na aba LOGS
function createLogObject(options = {}) {
    return {
        log_id: generateId(),
        timestamp: now(),
        level: options.level || LOG_LEVEL.INFO,
        module: options.module || "",
        function_name: options.functionName || "",
        action: options.action || "",
        description: options.description || "",
        user: options.user || getUser(),
        deal_id: options.dealId || "",
        token: options.token || "",
        execution_time: options.executionTime || "",
        payload: serialize(
            sanitizePayload(options.payload)
        ),

        stack: options.stack || ""
    };
}

// Registro de um evento na tabela de LOGS
// Todas as demais funções utilizam esse método internamente
function log(options = {}) {
    try {
        const logObject = createLogObject(options);

        DatabaseService.insert(
            CONFIG.SHEETS.LOGS,
            logObject
        );

        return logObject;
    } catch (error) {
        Logger.log(
            "[LoggerService] Falha ao registrar log: "
            + error.message
        );

        return null;

    }
}

// Registra um log de informação
function info(options = {}) {
    return log({
        ...options,
        level: LOG_LEVEL.INFO
    });
}

// Registra um log de aviso
function warning(options = {}) {
    return log({
        ...options,
        level: LOG_LEVEL.WARNING
    });
}

// Registra um erro
function error(options = {}) {
    return log({
        ...options,
        level: LOG_LEVEL.ERROR
    });
}

// Registra informações de depuração
function debug(options = {}) {
    return log({
        ...options,
        level: LOG_LEVEL.DEBUG
    });
}

// Registra eventos relacionados à segurança
function security(options = {}) {
    return log({
        ...options,
        level: LOG_LEVEL.SECURITY,

        module: options.module || "SecurityService"
    });
}

// Registra os acessos ao TravelWallet
function access(options = {}) {
    return info({
        ...options,
        module: options.module || "ClientService",
        action: option.action || "ACCESS"
    });
}

// Registra o recebimento de Webhooks
function webhook(options = {}) {
    return info({
        ...options,
        module: options.module || "Webhook",
        action: options.action || "WEBHOOK"
    });
}

// Registra operações do Google Drive
function drive(options = {}) {
    return info({
        ...options,
        module: options.module || "DriveService",
        action: options.action || "DRIVE"
    });
}

// Registra operações do banco de dados
function database(options = {}) {
    return info({
        ...options,
        module: options.module || "DatabaseService",
        action: options.action || "DATABASE"
    });
}

// Registra o tempo de execução
function performance(options = {}) {
    return info({
        ...options,
        module: options.module || "Performance",
        action: options.action || "PERFORMANCE"
    });
}

// Registra exceções
function exception(exception, options = {}) {
    return error({
        ...options,
        description: exception.message,
        stack: exception.stack,
        payload: {
            name: exception.name,
            message: exception.message
        }
    });
}

// Inicia um cronômetro
function starTimer() {
    return Date.now;
}

// Finaliza o cronômetro e registra automaticamente
// Log de desempenho
function stopTimer(startTime, options = {}) {
    const executionTime = Date.now() - startTime;

    performance({
        ...options,

        executionTime: executionTime
    });

    return executionTime;
}