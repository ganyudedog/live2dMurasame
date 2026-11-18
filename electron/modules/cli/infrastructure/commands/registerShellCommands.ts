import { z } from 'zod';
import type { CliService } from '../../service/CliService.js';
import { runWindowsShell, type ShellResult } from '../windowsShell.js';
import { WINDOWS_SHELL_COMMANDS, type ShellAccess } from '../windowsShellPolicy.js';

export const registerShellCommands = (
  cli: CliService,
  shellAccess: () => ShellAccess,
  runShell: (command: string, access: ShellAccess) => Promise<ShellResult> = runWindowsShell,
): void => {
  cli.register('shell.run', {
    skill: 'development',
    description: `在真实 Windows 环境执行查询，不保留会话。允许命令：${WINDOWS_SHELL_COMMANDS.join(', ')}。支持管道、常量参数以及 $HOME、$PWD、$Desktop、$Documents；Where-Object 使用属性参数形式。不允许脚本块、子表达式、重定向、方法调用、环境变量或外部程序。Get-Content、Select-String、Get-FileHash 只能读取本机已配置的可读目录，被拒绝说明该目录还不能读，不要换命令再试。中文目录原样返回。多个相近目录时询问用户再登记。`,
    schema: z.object({ command: z.string().min(1).max(2000) }).strict(),
    execute: (args) => runShell(args.command, shellAccess()),
  });
};
