import type { NapCatUiContext } from '../types';
import { NapCatPeopleSection } from '../NapCatPeopleSection';

/** QQ 用户：主人绑定，以及每个人的称呼、关系和人物描述。 */
export function NapCatPeoplePage(context: NapCatUiContext) {
  return <NapCatPeopleSection storage={context.storage} logger={context.logger} />;
}
