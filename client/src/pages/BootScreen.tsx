import { Spinner } from '../components/ui';
import { BrandMark } from '../components/Brand';

/** 로그인 확인 중 */
export function BootScreen() {
  return (
    <div className="boot-screen">
      <BrandMark size={40} />
      <Spinner size={18} />
    </div>
  );
}
