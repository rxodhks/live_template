import { useState } from 'react';
import { ExternalLink, PlugZap, RefreshCw, Server } from 'lucide-react';
import { Button, Field } from '../components/ui';
import { REPO, SERVER_URL, checkServer, normalizeServerUrl, saveServerUrl } from '../lib/server';

/**
 * GitHub Pages(정적 호스팅)에서 처음 열었거나, 저장된 서버에 연결할 수 없을 때 보여주는 화면.
 * 실시간 협업은 서버가 있어야 하므로 서버 주소를 연결한다.
 */
export function ServerSetup({ reason }: { reason: 'setup' | 'down' }) {
  const [value, setValue] = useState(SERVER_URL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const url = normalizeServerUrl(value);
    if (!url) {
      setError('올바른 주소를 입력해 주세요. 예) https://my-codespace-3001.app.github.dev');
      return;
    }
    if (window.location.protocol === 'https:' && url.startsWith('http:') && !/\/\/(localhost|127\.0\.0\.1)/.test(url)) {
      setError('이 페이지는 HTTPS라서 http:// 서버에는 연결할 수 없습니다. HTTPS 주소를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError(null);
    if (await checkServer(url)) saveServerUrl(url);
    else {
      setBusy(false);
      setError('서버가 응답하지 않습니다. 주소가 맞는지, 서버가 켜져 있는지(Codespaces라면 포트가 Public인지) 확인해 주세요.');
    }
  };

  const codespacesUrl = REPO ? `https://codespaces.new/${REPO}?quickstart=1` : 'https://github.com/codespaces';

  return (
    <div className="server-setup">
      <div className="server-card">
        <div className="server-brand">
          <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M9 8v13a3 3 0 0 0 3 3h11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            <circle cx="21" cy="11" r="3.5" fill="#ffd166" />
          </svg>
          <span>LiveTemplate</span>
        </div>

        {reason === 'down' ? (
          <>
            <h1>
              <RefreshCw size={22} /> 서버에 연결할 수 없습니다
            </h1>
            <p className="muted">
              <code>{SERVER_URL}</code> 이(가) 응답하지 않습니다. GitHub Codespaces 서버라면 일정 시간 사용하지 않으면 잠들기 때문에, GitHub에서 Codespace를 다시 열면 됩니다.
            </p>
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => window.location.reload()}>
              다시 시도
            </Button>
          </>
        ) : (
          <>
            <h1>
              <PlugZap size={22} /> 협업 서버 연결
            </h1>
            <p className="muted">
              이 페이지(GitHub Pages)는 화면만 제공합니다. 여러 사람이 실시간으로 함께 작업하려면 LiveTemplate 서버 주소를 한 번 연결해 주세요. 초대 링크를 받았다면 서버가 자동으로 연결됩니다.
            </p>
          </>
        )}

        <div className="server-form">
          <Field label="서버 주소" error={error}>
            <input
              className="input"
              value={value}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="https://이름-3001.app.github.dev"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void connect()}
              data-autofocus
            />
          </Field>
          <Button variant={reason === 'down' ? 'secondary' : 'primary'} icon={<Server size={15} />} onClick={connect} loading={busy} disabled={!value.trim()}>
            {reason === 'down' ? '다른 서버로 연결' : '연결'}
          </Button>
        </div>

        <div className="server-help">
          <b>아직 서버가 없나요?</b>
          <ol>
            <li>
              <a href={codespacesUrl} target="_blank" rel="noreferrer" className="link">
                GitHub Codespaces에서 서버 실행 <ExternalLink size={12} />
              </a>{' '}
              — 1~2분 뒤 터미널에 서버 주소가 표시됩니다.
            </li>
            <li>Ports 탭에서 3001 포트를 <b>Public</b>으로 바꾼 뒤, 그 주소를 위에 붙여 넣으세요.</li>
          </ol>
          <p className="muted small">Codespaces 주소를 그대로 열어도 앱 전체를 사용할 수 있습니다.</p>
        </div>
      </div>
    </div>
  );
}
