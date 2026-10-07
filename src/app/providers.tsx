'use client';

import { App as AntdApp, ConfigProvider, type ThemeConfig } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import type { ReactNode } from 'react';

import { StoreProvider } from '@/store/StoreProvider';

dayjs.locale('ru');

/** Ant Design theme mapped 1:1 onto the RoomBook design tokens. */
const theme: ThemeConfig = {
  cssVar: { key: 'roombook' },
  token: {
    colorPrimary: '#1f4fd8',
    colorError: '#b3261e',
    colorText: '#15171c',
    colorTextSecondary: '#5a5f69',
    colorTextDescription: '#5a5f69',
    colorTextPlaceholder: '#5a5f69',
    colorBorder: '#857f70',
    colorBorderSecondary: '#d9d5cb',
    colorBgLayout: '#f3f1ec',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorFillTertiary: '#f3f1ec',
    fontFamily: "var(--font-onest), 'Golos Text', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: 15,
    lineHeight: 22 / 15,
    borderRadius: 6,
    borderRadiusLG: 16,
    controlHeight: 44,
    controlHeightLG: 44,
    colorBgMask: 'rgba(21, 23, 28, 0.48)',
    boxShadowSecondary: '0 4px 8px #15171c14, 0 16px 32px -4px #15171c29',
    motionDurationMid: '0.16s',
  },
  components: {
    Button: {
      borderRadius: 10,
      fontWeight: 600,
      contentFontSize: 13,
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
    },
    Modal: {
      borderRadiusLG: 16,
      titleFontSize: 20,
      titleLineHeight: 28 / 20,
    },
    Alert: {
      borderRadiusLG: 10,
    },
  },
};

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <ConfigProvider theme={theme} locale={ruRU}>
        <AntdApp component={false}>{children}</AntdApp>
      </ConfigProvider>
    </StoreProvider>
  );
}
