import type { AstrBotUiContext } from '../types';
import { AstrBotPeopleSection } from '../AstrBotPeopleSection';

/** QQ 用户：主人绑定，以及每个人的称呼、关系和人物描述。 */
export function AstrBotPeoplePage(context: AstrBotUiContext) {
  return <AstrBotPeopleSection storage={context.storage} logger={context.logger} />;
}
