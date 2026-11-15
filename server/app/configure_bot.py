"""Set the bot's launch button after an HTTPS URL is ready. No polling process needed."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser=argparse.ArgumentParser(description="Настроить кнопку запуска new0 Mini App")
    parser.add_argument("--url",required=True,help="Публичный HTTPS-адрес игры")
    args=parser.parse_args()
    parsed=urllib.parse.urlparse(args.url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        parser.error("Нужен HTTPS-адрес без учётных данных")
    token=os.getenv("TELEGRAM_BOT_TOKEN","")
    if not token:
        print("Укажи новый TELEGRAM_BOT_TOKEN в локальном .env. Токен не передаётся аргументом команды.",file=sys.stderr)
        return 1

    def call(method,body):
        req=urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}",
            data=json.dumps(body).encode(),headers={"Content-Type":"application/json"})
        with urllib.request.urlopen(req,timeout=20) as response:
            result=json.load(response)
        if not result.get("ok"): raise ValueError("Telegram отклонил запрос")
        return result["result"]

    try:
        bot=call("getMe",{})
        expected=int(os.getenv("TELEGRAM_BOT_ID","9210184678"))
        if bot["id"] != expected or bot.get("username","").lower() != "new0_game":
            print("Токен принадлежит другому боту. Настройки не изменены.",file=sys.stderr)
            return 1
        call("setChatMenuButton",{"menu_button":{"type":"web_app","text":"Играть","web_app":{"url":args.url}}})
        menu=call("getChatMenuButton",{})
        if menu.get("web_app",{}).get("url") != args.url:
            print("Не удалось подтвердить адрес кнопки.",file=sys.stderr)
            return 1
        print("Кнопка «Играть» для @new0_game настроена и проверена.")
        return 0
    except urllib.error.HTTPError as exc:
        # Never print exception URLs: Telegram's URL contains the token.
        print(f"Telegram вернул HTTP {exc.code}. Проверь новый токен и HTTPS-адрес.",file=sys.stderr)
        return 1
    except (urllib.error.URLError,TimeoutError,ValueError,KeyError):
        print("Не удалось подтвердить настройку. Проверь соединение и параметры, затем повтори команду.",file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
