// Настройки подключения к Supabase (Project Settings → API).
window.APP_CONFIG = {
  // функция запускается рядом с базой (Сеул), иначе каждый запрос к базе идёт из Франкфурта и всё медленно
  FUNCTION_URL: 'https://cczxbzolewxvrsmptuyw.supabase.co/functions/v1/api?forceFunctionRegion=ap-northeast-2',
  // anon-ключ публичный: без подписи Telegram функция всё равно ничего не отдаст
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjenhiem9sZXd4dnJzbXB0dXl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMzUyMzQsImV4cCI6MjEwNTkxMTIzNH0.n0OMF1dj0vSCAtFarzZANXHIvO3c8uSIEXz1e69C12o',
};
