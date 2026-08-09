import type { ComponentType } from 'react';
import { DevToolsSettingsPage } from './dev-tools/DevToolsSettingsPage';

export interface BuiltinSettingsPageProps {
  onClose: () => void;
  embedded?: boolean;
}

export const BUILTIN_SETTINGS_PAGES: Record<string, ComponentType<BuiltinSettingsPageProps>> = {
  'dev-tools': DevToolsSettingsPage,
};
