import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Где ядру хранить своё состояние: память сессий, счётчик расхода,
 * отчёт диагностики.
 *
 * Раньше пути строились как `new URL('../memory-store.json',
 * import.meta.url)` прямо в модулях. Это ломалось дважды.
 *
 * Во-первых, сборщики (Turbopack, webpack) принимают такую конструкцию за
 * импорт модуля и пытаются найти файл на этапе сборки — а его там нет и
 * быть не должно, он появляется в рантайме. Сборка падала с «Module not
 * found» на ровном месте.
 *
 * Во-вторых, каталог пакета почти всегда доступен только для чтения: на
 * serverless-хостинге, в контейнере, при глобальной установке. Ядро писало
 * туда без всякой обработки ошибок и роняло каждый запрос.
 *
 * Здесь путь собирается из строк, никакой сборщик его не видит, и каталог
 * выбирается по факту записываемости.
 */

/** Явное переопределение — самый надёжный способ на любом хостинге. */
const ENV_DIR = process.env.AI_KERNEL_STATE_DIR;

function isWritable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let resolved = null;

/**
 * Каталог для файлов состояния. Определяется один раз за процесс.
 *
 * Порядок: явная переменная окружения → каталог пакета, если в него можно
 * писать → системный временный каталог. Последний вариант означает, что
 * память сессий не переживёт перезапуск инстанса, и это правильный размен:
 * лучше забывчивое ядро, чем упавший запрос.
 */
export function stateDir() {
  if (resolved) return resolved;

  if (ENV_DIR) {
    try {
      fs.mkdirSync(ENV_DIR, { recursive: true });
    } catch {
      // Не вышло — упадём на следующий вариант.
    }
    if (isWritable(ENV_DIR)) {
      resolved = ENV_DIR;
      return resolved;
    }
  }

  const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  resolved = isWritable(packageDir) ? packageDir : os.tmpdir();
  return resolved;
}

/** Полный путь к файлу состояния по его имени. */
export function statePath(fileName) {
  return path.join(stateDir(), fileName);
}

let warned = false;

/**
 * Записать файл состояния, переживая отсутствие прав.
 *
 * Состояние ядра — вещь полезная, но не критичная: без него сессия просто
 * не помнит прошлых ходов, а расход не считается. Ронять из-за этого
 * запрос пользователя недопустимо, поэтому ошибка записи гасится и один
 * раз за процесс сообщается в консоль.
 */
export function writeState(filePath, contents) {
  try {
    fs.writeFileSync(filePath, contents, 'utf-8');
    return true;
  } catch (error) {
    if (!warned) {
      warned = true;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[ai-kernel] состояние не сохраняется (${reason}). ` +
          'Работа продолжается, но память сессий не переживёт перезапуск. ' +
          'Задай AI_KERNEL_STATE_DIR, если нужна постоянная память.',
      );
    }
    return false;
  }
}
