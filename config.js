const CONFIG = {
    
    // Acesso a base de dados do TravelWallet
    DATABASE_TRAVELWALLET: "",

    // Acesso a base de dados dos orçamentos
    DATABASE_CRM: "",

    SHEETS: {
        TOKENS: "TOKENS",
        ACESSOS: "ACESSOS",
        LOGS: "LOGS",
        CONFIG: "CONFIG",

        ORCAMENTOS: "ORÇAMENTOS"
    },

    // Define o tempo de vida útil de um token de acesso em dias
    // Após o período o token expira e o usuário precisa de uma nova autenticação
    TOKEN_VALIDITY_DAYS: 365,

    APP_NAME: "TRAVELWALLET",

    VERSION: "1.0.0"

};
