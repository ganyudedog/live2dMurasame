import { useCallback, useEffect, useState } from 'react';
import { BotMessageSquare, RotateCcw, ScrollText } from 'lucide-react';
import type { AstrBotUiContext } from '../types';
import { StickerSection } from '../stickers/StickerSection';
import { GHOST_BUTTON_XS, SELECT, TEXTAREA } from '../styles';
import { DEFAULT_ASTRBOT_SETTINGS, type AstrBotBridgeSettings } from '../settings';
import { Field, LoadingCard, SaveFeedback, Section } from '../ui/layout';
import { useBridgeSettings, type BridgeSettingsStore } from '../ui/useBridgeSettings';

const DISPLAY_LANGS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'ko', label: '韩语' },
] as const;

const SPEAK_LANGS = [
  { value: '', label: '仅文字' },
  { value: 'all_zh', label: '中文' },
  { value: 'all_en', label: '英语' },
  { value: 'all_ja', label: '日语' },
  { value: 'all_ko', label: '韩语' },
  { value: 'all_yue', label: '粤语' },
  { value: 'auto', label: '自动' },
] as const;

/** 回复方式：什么语言、在 QQ 场景里怎么说话，以及可以发的收藏表情。 */
export function AstrBotReplyPage(context: AstrBotUiContext) {
  const store = useBridgeSettings(context);
  if (!store.loaded) return <LoadingCard>正在读取插件配置…</LoadingCard>;
  return <ReplyForm store={store} context={context} />;
}

function ReplyForm({ store, context }: { store: BridgeSettingsStore; context: AstrBotUiContext }) {
  const { settings, update } = store;
  const ai = context.hostApi.ai;
  const readChat = useCallback(() => ai?.getModels().find(model => model.chatEffort !== undefined), [ai]);
  const [chat, setChat] = useState(readChat);
  useEffect(() => {
    const refresh = () => setChat(readChat());
    refresh();
    return ai?.subscribe(refresh);
  }, [ai, readChat]);
  const [promptDraft, setPromptDraft] = useState(settings.systemPrompt);
  const promptDirty = promptDraft !== settings.systemPrompt;

  return <div className="space-y-4">
    <Section icon={<BotMessageSquare />} title="回复生成" description="QQ 回复使用宿主当前的对话模型。">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="思考深度">
          <select aria-label="思考深度" className={`${SELECT} w-full`}
            value={settings.reasoningEffort}
            onChange={(event) => update({ reasoningEffort: event.target.value })}>
            <option value="">跟随内核{chat?.chatEffort ? `（${chat.chatEffort}）` : ''}</option>
            {settings.reasoningEffort && !chat?.efforts.includes(settings.reasoningEffort) &&
              <option value={settings.reasoningEffort} disabled>{settings.reasoningEffort}（当前不可用，跟随内核）</option>}
            {chat?.efforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select>
        </Field>
        <Field label="展示语言">
          <select className={`${SELECT} w-full`} value={settings.displayLang}
            onChange={(event) => update({ displayLang: event.target.value as AstrBotBridgeSettings['displayLang'] })}>
            {DISPLAY_LANGS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>

        <Field label="朗读文本" hint={settings.speakLang ? undefined : '仅文字：不生成朗读文本'}>
          <select className={`${SELECT} w-full`} value={settings.speakLang}
            onChange={(event) => update({ speakLang: event.target.value as AstrBotBridgeSettings['speakLang'] })}>
            {SPEAK_LANGS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </Field>
      </div>
    </Section>

    <Section icon={<ScrollText />} title="场景说明"
      description="角色本人的名字、口吻、示例、边界和补充设定由应用注入。QQ 称呼和关系在「QQ 用户」页单独配置，不会自动同步桌面角色。"
      actions={<>
        <span className={`text-[11px] tabular-nums ${promptDirty ? 'text-warning' : 'text-muted-foreground/70'}`}>
          {promptDraft.length} 字{promptDirty ? ' · 有未保存的修改' : ''}
        </span>
        {promptDirty && (
          <button type="button" className={GHOST_BUTTON_XS}
            onClick={() => { setPromptDraft(DEFAULT_ASTRBOT_SETTINGS.systemPrompt); update({ systemPrompt: DEFAULT_ASTRBOT_SETTINGS.systemPrompt }); }}>
            <RotateCcw aria-hidden="true" />
            恢复默认
          </button>
        )}
      </>}>
      <textarea className={`${TEXTAREA} h-56 w-full resize-y`} value={promptDraft} aria-label="场景说明"
        placeholder="例如：QQ 群聊场景，每条不超过两句话，避免使用列表和标题"
        onChange={(event) => setPromptDraft(event.target.value)}
        onBlur={() => update({ systemPrompt: promptDraft })} />
    </Section>

    <StickerSection storage={context.storage} />

    <SaveFeedback saved={store.saved} saveError={store.saveError} />
  </div>;
}
