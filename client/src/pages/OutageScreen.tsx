import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { BrandMark, CONTACT_EMAIL } from '../components/Brand';
import { Button } from '../components/ui';
import { bootSession } from '../lib/auth';
import { reportError } from '../lib/errorReport';
import { useSession } from '../store/session';

/*
 * 장애 안내 화면
 *  · ServerDownScreen: 서버(협업 API)에 연결할 수 없을 때 — 처음 오는 사람은 로그인 화면 대신 이 화면을 본다
 *    (이 기기에 로그인 정보가 있으면 개인 공간을 계속 쓸 수 있으므로 이 화면 대신 오프라인 표시만 나온다)
 *  · AppErrorBoundary: 화면을 그리다 오류가 나서 흰 화면만 남을 때
 * 앱 파일 자체를 받지 못한 경우는 index.html의 안내가 대신 맡는다.
 */

/** 서버 연결을 자동으로 다시 확인하는 간격 */
const RETRY_MS = 20_000;

function OutageView(props: { title: string; message: ReactNode; code: string; action: ReactNode }) {
  const { title, message, code, action } = props;
  const at = new Date().toLocaleString('ko-KR');
  const body = `발생 시각: ${at}\n주소: ${window.location.href}\n오류: ${code}\n브라우저: ${navigator.userAgent}\n\n어떤 상황이었는지 알려 주시면 도움이 됩니다:\n`;
  const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[Madang 오류] ${code}`)}&body=${encodeURIComponent(body)}`;
  return (
    <main className="outage-screen" role="alert">
      <div className="outage-card">
        <BrandMark size={40} />
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="outage-actions">{action}</div>
        <p className="outage-contact">
          문제가 계속되면 <a href={mailto}>{CONTACT_EMAIL}</a>로 알려 주세요.
        </p>
        <p className="outage-code">
          {code} · {at}
        </p>
      </div>
    </main>
  );
}

export function ServerDownScreen() {
  const code = useSession((s) => s.downCode);
  const [checking, setChecking] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const retry = () => {
    setChecking(true);
    // 연결되면 상태가 바뀌어 이 화면이 사라진다
    void bootSession().finally(() => setChecking(false));
  };

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && retry(), RETRY_MS);
    const on = () => {
      setOnline(true);
      retry();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (!online) {
    return (
      <OutageView
        title="인터넷에 연결되어 있지 않습니다"
        message="네트워크 연결을 확인해 주세요. 다시 연결되면 자동으로 이어집니다."
        code="오프라인"
        action={<RetryButton checking={checking} onClick={retry} />}
      />
    );
  }
  return (
    <OutageView
      title="서비스에 일시적인 문제가 있습니다"
      message="지금 Madang 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. 이 화면은 자동으로 다시 연결을 시도합니다."
      code={code ? `서버 응답 ${code}` : '서버 응답 없음'}
      action={<RetryButton checking={checking} onClick={retry} />}
    />
  );
}

function RetryButton({ checking, onClick }: { checking: boolean; onClick: () => void }) {
  return (
    <Button variant="primary" icon={<RotateCw size={15} />} loading={checking} onClick={onClick}>
      다시 시도
    </Button>
  );
}

/** 새 버전 배포로 예전 화면 파일이 사라졌거나, 화면 파일을 받는 중 연결이 끊긴 경우 */
const isChunkError = (err: unknown) =>
  err instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(err.message);

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError(error);
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    const name = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return (
      <OutageView
        title={chunk ? '화면을 불러오지 못했습니다' : '화면을 표시하는 중 오류가 발생했습니다'}
        message={
          chunk
            ? '새 버전이 배포되었거나 연결이 잠시 끊겼습니다. 새로고침하면 대부분 해결됩니다.'
            : '새로고침하면 다시 이어서 쓸 수 있습니다.'
        }
        code={name.slice(0, 160)}
        action={
          <Button variant="primary" icon={<RotateCw size={15} />} onClick={() => window.location.reload()}>
            새로고침
          </Button>
        }
      />
    );
  }
}
