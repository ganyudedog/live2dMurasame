const TIME_ZONE = 'Asia/Shanghai';
const DAY_MS = 86400000;

export type EpisodeSpeaker = 'user' | 'assistant' | 'both';

export interface EpisodeQuery {
  status: 'none' | 'resolved' | 'expired';
  dates: string[];
  query: string;
  speaker: EpisodeSpeaker;
  approximate: boolean;
  expression?: string;
}

const dateParts = (value: number): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
};

const formatDate = (value: Date): string => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;

const offsetDate = (now: number, offsetDays: number): string => {
  const current = dateParts(now);
  return formatDate(new Date(Date.UTC(current.year, current.month - 1, current.day + offsetDays)));
};

const datesForOffsets = (now: number, offsets: number[]): string[] => [...new Set(offsets.map((offset) => offsetDate(now, offset)))];

const chineseNumber = (value: string): number => {
  if (/^\d+$/u.test(value)) return Number(value);
  if (value === '两' || value === '俩') return 2;
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value.length === 1 && value in digits) return digits[value];
  if (value === '十') return 10;
  const ten = value.indexOf('十');
  if (ten >= 0) {
    const left = ten === 0 ? 1 : digits[value.slice(0, ten)] ?? 0;
    const right = ten === value.length - 1 ? 0 : digits[value.slice(ten + 1)] ?? 0;
    return left * 10 + right;
  }
  return NaN;
};

const compactQuery = (input: string, expression?: string): string => {
  let value = input;
  if (expression) value = value.replace(expression, ' ');
  return value
    .replace(/(?:我|我们|你|你们)?\s*(?:说过|说了|提到过|聊过|谈过|讲过)/gu, ' ')
    .replace(/(?:什么|哪些|哪件事|哪方面|发生了|发生|聊天内容|对话内容|聊天|对话|吗|么)/gu, ' ')
    .replace(/[，。！？、,.!?：:；;“”"'‘’()（）[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
};

const speakerOf = (input: string): EpisodeSpeaker => {
  if (/(?:我|用户)[^，。！？\n]{0,12}(?:说|提到|讲过|聊过|谈过|讲过)/u.test(input)) return 'user';
  if (/(?:你|角色|助手)[^，。！？\n]{0,12}(?:说|提到|讲过|聊过|谈过|讲过)/u.test(input)) return 'assistant';
  return 'both';
};

const clampToRetention = (dates: string[], now: number): { dates: string[]; expired: boolean } => {
  const today = dateParts(now);
  const todayNumber = Date.UTC(today.year, today.month - 1, today.day) / DAY_MS;
  const kept = dates.filter((date) => {
    const [year, month, day] = date.split('-').map(Number);
    const age = todayNumber - Date.UTC(year, month - 1, day) / DAY_MS;
    return age >= 0 && age <= 7;
  });
  return { dates: kept, expired: dates.length > 0 && kept.length === 0 };
};

/**
 * 只解析日期和说话人范围，不调用模型。episode 的文件名是日期索引，
 * 因此历史查询可以在当前 LLM 请求前完成，不增加一次模型往返。
 */
export const resolveEpisodeQuery = (input: string, now = Date.now()): EpisodeQuery => {
  const text = String(input ?? '').trim();
  const speaker = speakerOf(text);
  // 模糊时间只限定搜索窗口，不猜测具体日期；片段相关性交给后端 BM25。
  const vagueTime = ['之前', '以前', '上次', '先前', '前面', '刚才'].find((word) => text.includes(word));
  const dateSignal = /(?:\d{1,4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?|\d{1,2}月\d{1,2}日?|今天|今日|昨天|昨日|前天|大前天|前几天|最近几天|这几天|最近一周|这周|这一周|\d+[天日]前|[一二三四五六七八九十两俩]+天前|两周前|上上周|十几天前)/u.test(text);
  const historySignal = /(?:我|我们|你|你们).*(?:说|提到|聊|谈|讲|记得|之前|那天|当时)|(?:说过|说了|提到过|聊过|谈过|讲过|之前的对话|历史对话|回忆一下|发生了什么|聊天内容)/u.test(text)
    || (dateSignal && /(?:什么|哪件|哪方面|发生|对话|聊天|内容|记得|说|提到|聊|谈|讲)/u.test(text));
  if (!historySignal && !vagueTime) return { status: 'none', dates: [], query: '', speaker, approximate: false };
  let dates: string[] = [];
  let expression = '';
  let approximate = false;

  const absolute = text.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日?/u)
    ?? text.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})/u);
  if (absolute) {
    const current = dateParts(now);
    const year = Number(absolute[1] ?? current.year);
    const month = Number(absolute[2]);
    const day = Number(absolute[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      dates = [formatDate(new Date(Date.UTC(year, month - 1, day)))];
      expression = absolute[0];
    }
  }

  if (!dates.length) {
    const stale = text.match(/(?:两周前|上上周|十几天前)/u);
    if (stale) {
      return { status: 'expired', dates: [], query: compactQuery(text, stale[0]), speaker, approximate: true, expression: stale[0] };
    }
  }

  if (!dates.length) {
    const daysBefore = text.match(/([0-9一二三四五六七八九十两俩]+)天前/u);
    if (daysBefore) {
      const offset = chineseNumber(daysBefore[1]);
      if (Number.isFinite(offset)) {
        dates = datesForOffsets(now, [-offset]);
        expression = daysBefore[0];
      }
    }
  }

  if (!dates.length) {
    const exactRules: Array<[RegExp, number]> = [
      [/大前天/u, -3], [/前天/u, -2], [/(?:昨天|昨日)/u, -1], [/(?:今天|今日)/u, 0],
    ];
    const rule = exactRules.find(([pattern]) => pattern.test(text));
    if (rule) {
      dates = datesForOffsets(now, [rule[1]]);
      expression = text.match(rule[0])?.[0] ?? '';
    }
  }

  if (!dates.length) {
    const rangeRules: Array<[RegExp, number[]]> = [
      [/(?:前几天|前几日)/u, [-3, -2, -1]],
      [/(?:最近几天|这几天)/u, [-3, -2, -1, 0]],
      [/(?:最近一周|这周|这一周)/u, [-7, -6, -5, -4, -3, -2, -1, 0]],
    ];
    const rule = rangeRules.find(([pattern]) => pattern.test(text));
    if (rule) {
      dates = datesForOffsets(now, rule[1].slice().reverse());
      expression = text.match(rule[0])?.[0] ?? '';
      approximate = true;
    }
  }

  if (!dates.length && (vagueTime || historySignal)) {
    dates = datesForOffsets(now, [0, -1, -2, -3, -4, -5, -6, -7]);
    expression = vagueTime ?? '';
    approximate = true;
  }
  if (!dates.length) return { status: 'none', dates: [], query: '', speaker, approximate: false };
  const bounded = clampToRetention(dates, now);
  return {
    status: bounded.expired ? 'expired' : 'resolved',
    dates: bounded.dates,
    query: compactQuery(text, expression),
    speaker,
    approximate,
    expression,
  };
};
