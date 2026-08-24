// ---------------------------------------------------------------
// Configuração do site — edite estes valores para o seu caso.
// ---------------------------------------------------------------
const CONFIG = {
  // Cole aqui a URL do seu Apps Script publicado como Web App
  // (Implantar > Nova implantação > Aplicativo da Web).
  // Deve terminar em /exec
  WEB_APP_URL: "https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec",

  // Janela de datas em que a sessão de Natal está disponível.
  SESSION_START: "2026-12-01",
  SESSION_END:   "2026-12-24",

  // Duração de cada sessão, em minutos (deve bater com o Code.gs).
  SLOT_MINUTES: 40,

  // Número de WhatsApp do estúdio, em formato internacional, só dígitos
  // (código do país + DDD + número). Exemplo para (96) 99999-9999:
  STUDIO_WHATSAPP_NUMBER: "5596999999999",
};
