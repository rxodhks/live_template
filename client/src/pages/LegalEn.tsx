import { BRAND, CONTACT_EMAIL } from '../components/Brand';

/*
 * 개인정보처리방침 · 이용약관의 참고용 영어 번역 (영어 화면에서만 보인다)
 * 법적 효력은 한국어 원문(Legal.tsx)에 있다. 원문을 고치면 이 번역도 같은 내용으로 함께 고친다.
 */

const OPERATOR_EN = 'the Madang team';
const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

/** '2026년 10월 3일' → 'October 3, 2026' */
export function enDate(ko: string): string {
  const m = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/.exec(ko); // i18n-ignore
  if (!m) return ko;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
}

export function PrivacyEn({ effectiveDate, previous }: { effectiveDate: string; previous: string[] }) {
  return (
    <>
      <p>
        The Madang team (“we,” “us,” or “our”) values the personal information of everyone who uses {BRAND} (madang.party, the “Service”) and complies with the Personal Information
        Protection Act of the Republic of Korea and other applicable laws. This policy explains what information we collect and why, how long we keep it, and how we protect it.
      </p>

      <h2>1. Personal information we collect</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>What we collect</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Signing up or signing in with email</td>
            <td>Email address</td>
          </tr>
          <tr>
            <td>Signing up or signing in with Google</td>
            <td>Google account ID, email address and whether it is verified, and name (used only to pre-fill the sign-up form)</td>
          </tr>
          <tr>
            <td>Signing up or signing in with GitHub</td>
            <td>GitHub account ID, verified primary email address, and name or username (used only to pre-fill the sign-up form)</td>
          </tr>
          <tr>
            <td>Information you enter when signing up</td>
            <td>Display name, cursor color, and avatar</td>
          </tr>
          <tr>
            <td>Registering a passkey (optional)</td>
            <td>
              Passkey public key and ID, the browser and operating system of the registering device, and when the passkey was registered and last used (fingerprint and face data never
              leave your device and are never sent to us)
            </td>
          </tr>
          <tr>
            <td>Using templates</td>
            <td>
              Template content (designs, code, and documents) and version history, encrypted secret notes, chat messages, activity history (timeline), invite links and join records,
              and member roles
            </td>
          </tr>
          <tr>
            <td>Generated or collected automatically</td>
            <td>
              Sign-in session information (browser type, and when the session was created and last used), a hash of a random value that identifies devices you have signed in on,
              IP address (used only to limit request volume), and approximate location (city and country) included in new-device sign-in alerts (not stored)
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          Templates in your <b>personal space</b> are stored on our servers to prevent loss, and only you can see them. Templates in a <b>shared space</b> are visible only to invited
          members. We do not view template content except when necessary to provide the Service or respond to an outage.
        </li>
        <li>
          <b>Secret notes</b> are encrypted in your browser before they are stored, and no one who does not know the password, including us, can read them.
        </li>
        <li>Passwords for external accounts are never shared with us, and the Service never receives or stores them.</li>
      </ul>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To identify members, process sign-ups and sign-ins, and keep you signed in</li>
        <li>
          To provide collaboration features: showing your display name, avatar, cursor, and activity to the members you work with, and saving and syncing template content
        </li>
        <li>To prevent abuse and protect the Service, for example by limiting verification code requests</li>
        <li>To respond to inquiries and send notices about the Service</li>
      </ul>
      <p>We do not use the information we collect for advertising or marketing, and we do not use analytics tools that track your behavior or advertising cookies.</p>

      <h2>3. How long we keep your information</h2>
      <table>
        <thead>
          <tr>
            <th>Information</th>
            <th>Retention period</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account information (email, external account ID, display name, etc.)</td>
            <td>Until you delete your account</td>
          </tr>
          <tr>
            <td>Sign-in sessions</td>
            <td>90 days after last use (deleted immediately when you sign out)</td>
          </tr>
          <tr>
            <td>Passkeys</td>
            <td>Until you delete them or delete your account</td>
          </tr>
          <tr>
            <td>Records of devices you have signed in on</td>
            <td>400 days after your last sign-in (deleted immediately when you sign that device out from the device list)</td>
          </tr>
          <tr>
            <td>Email verification codes</td>
            <td>10 minutes after issue (deleted immediately once used)</td>
          </tr>
          <tr>
            <td>Sign-up progress information (after verification, before you choose a name)</td>
            <td>30 minutes</td>
          </tr>
          <tr>
            <td>IP addresses used to limit request volume</td>
            <td>1 hour</td>
          </tr>
          <tr>
            <td>Template content, chat, and activity history</td>
            <td>Until the template is deleted (deleted templates are kept in Trash for 30 days and then permanently deleted)</td>
          </tr>
          <tr>
            <td>Template version history</td>
            <td>Up to 30 days</td>
          </tr>
        </tbody>
      </table>
      <p>
        Content and activity you leave in a shared template are part of work created together with other members, so they may remain in the template after you delete your account. If you
        would like them deleted, please contact us by email. Where the law requires us to keep information, we keep it for the required period.
      </p>

      <h2>4. Sharing with third parties</h2>
      <p>We do not provide your personal information to third parties, except with your consent or where required by law.</p>

      <h2>5. Service providers and international transfers</h2>
      <p>
        To operate the Service, we entrust the processing of personal information to the companies below. As a result, your personal information may be stored and processed outside the
        Republic of Korea.
      </p>
      <table>
        <thead>
          <tr>
            <th>Recipient (country)</th>
            <th>Purpose</th>
            <th>Information transferred</th>
            <th>Retention period</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cloudflare, Inc. (United States; data centers worldwide)</td>
            <td>Hosting the Service and storing data</td>
            <td>All information stored on our servers as listed in Section 1</td>
            <td>The retention periods in Section 3</td>
          </tr>
          <tr>
            <td>Resend (United States)</td>
            <td>Sending sign-in verification codes and new-device sign-in alerts by email</td>
            <td>Email address, verification code, and the device type, time, and approximate location in new-device alerts</td>
            <td>Delivery records are kept according to Resend’s policies</td>
          </tr>
        </tbody>
      </table>
      <p>
        Transfers take place over an encrypted network connection (HTTPS) when you use the Service. If you do not want your information transferred abroad, you may choose not to use the
        Service or delete your account, but you will then be unable to use the Service. Google and GitHub sign-in are external account services you choose to use, and their own privacy
        policies also apply.
      </p>

      <h2>6. Deletion of personal information</h2>
      <p>
        We delete personal information without delay once its retention period ends or the purpose of processing has been achieved. Electronic files are deleted in a way that cannot be
        recovered. To prevent accidental loss, templates you delete are kept in Trash for 30 days before they are permanently deleted, and you can permanently delete them yourself before
        then.
      </p>

      <h2>7. Your rights and how to exercise them</h2>
      <ul>
        <li>You may request access to, correction or deletion of, or suspension of the processing of your personal information at any time.</li>
        <li>You can change your display name, cursor color, and avatar yourself from the profile menu in the Service.</li>
        <li>To delete your account or make any other request, email {mail}. We will process your request within 10 days after verifying your identity.</li>
        <li>Children under 14 may not sign up.</li>
      </ul>

      <h2>8. Cookies and browser storage</h2>
      <ul>
        <li>
          <b>Sign-in cookie</b>: Keeps you signed in (for up to 90 days after last use). It cannot be read by JavaScript and is sent only over HTTPS.
        </li>
        <li>
          <b>Sign-in progress cookies</b>: Used only during external account sign-in (10 minutes) and sign-up (30 minutes), and deleted when finished.
        </li>
        <li>
          <b>Device cookie</b>: Stores a random value that recognizes this browser for up to 400 days so we can alert you when someone signs in from a device we have not seen before. It
          cannot be read by JavaScript and is not used for any other purpose.
        </li>
        <li>
          <b>Browser storage</b>: To open templates quickly and let you keep editing when you are offline, we store copies of your templates, display settings, and your latest sign-in
          information in your browser. When you sign out, copies of templates saved on the server are removed from the browser. To make your next sign-in faster, we keep the email address
          and sign-in method you last used on this device, which you can clear with “Forget this email” on the sign-in screen.
        </li>
        <li>We do not use cookies for advertising or tracking. If you block cookies in your browser settings, you will not be able to sign in.</li>
      </ul>

      <h2>9. Security measures</h2>
      <ul>
        <li>All communication is encrypted with HTTPS.</li>
        <li>Sign-in session tokens and verification codes are stored only as hashes, never as their original values.</li>
        <li>Secret notes are protected with end-to-end encryption (AES-256).</li>
        <li>Every request is checked for sign-in and template membership, and non-members cannot even tell whether a template exists.</li>
        <li>Deleted templates are kept in Trash for 30 days, and template content is saved by version to prevent accidental loss.</li>
        <li>The number of verification code requests and attempts is limited.</li>
      </ul>

      <h2>10. Privacy officer</h2>
      <table>
        <tbody>
          <tr>
            <th>Responsible party</th>
            <td>{OPERATOR_EN}</td>
          </tr>
          <tr>
            <th>Contact</th>
            <td>{mail}</td>
          </tr>
        </tbody>
      </table>
      <p>Please send any privacy-related questions, complaints, or requests for remedy to the contact above, and we will respond promptly.</p>

      <h2>11. Remedies for privacy violations</h2>
      <p>If you need advice on or wish to report a privacy violation, you can contact the following Korean authorities.</p>
      <ul>
        <li>Personal Information Dispute Mediation Committee: 1833-6972 (www.kopico.go.kr)</li>
        <li>Personal Information Infringement Report Center: 118 (privacy.kisa.or.kr)</li>
        <li>Supreme Prosecutors’ Office: 1301 (www.spo.go.kr)</li>
        <li>Korean National Police Agency: 182 (ecrm.police.go.kr)</li>
      </ul>

      <h2>12. Changes to this policy</h2>
      <p>If we change this policy, we will post a notice in the Service at least 7 days before the change takes effect (30 days for changes that are unfavorable to users).</p>
      <p className="legal-meta">
        Supplementary provision: This Privacy Policy takes effect on {enDate(effectiveDate)}. (Previous version effective: {previous.map(enDate).join(', ')})
      </p>
    </>
  );
}

export function TermsEn({ effectiveDate }: { effectiveDate: string }) {
  return (
    <>
      <h2>Article 1 (Purpose)</h2>
      <p>
        These Terms set out the conditions and procedures for using {BRAND} (madang.party, the “Service”) provided by the Madang team (“we,” “us,” or “our”), as well as the rights,
        obligations, and responsibilities of the team and its members.
      </p>

      <h2>Article 2 (Definitions)</h2>
      <ul>
        <li>“Member”: A person who has signed up under these Terms and uses the Service</li>
        <li>“Template”: A workspace created by choosing design, code, and document features</li>
        <li>“Personal space”: A template that only the member can see</li>
        <li>“Shared space”: A template used together with invited members</li>
        <li>“Content”: All material a member creates or uploads to the Service, including designs, code, documents, chat messages, and secret notes</li>
      </ul>

      <h2>Article 3 (Posting and changes to these Terms)</h2>
      <ol>
        <li>We post these Terms in the Service.</li>
        <li>
          We may change these Terms to the extent permitted by applicable law, and we will post a notice in the Service at least 7 days before the change takes effect (30 days for changes
          that are unfavorable to members).
        </li>
        <li>
          If you do not agree to the revised Terms, you may stop using the Service and delete your account. If you continue to use the Service after the effective date, you will be deemed
          to have agreed to the revised Terms.
        </li>
      </ol>

      <h2>Article 4 (Signing up)</h2>
      <ol>
        <li>
          Sign-up is complete once you verify your identity with a Google or GitHub account or by email and choose a display name. At that point, you are deemed to have agreed to these
          Terms.
        </li>
        <li>Children under 14 may not sign up.</li>
        <li>You may not sign up using another person’s email address or external account.</li>
      </ol>

      <h2>Article 5 (Account management)</h2>
      <ol>
        <li>You are responsible for managing the email address and external accounts you use to sign in, and you must not let anyone else use them.</li>
        <li>If your account has been, or you suspect it has been, used without your permission, you must notify us immediately.</li>
        <li>Your display name is visible to other members, so you must not use a name that impersonates someone else or that others may find offensive.</li>
      </ol>

      <h2>Article 6 (Provision of the Service)</h2>
      <ol>
        <li>We provide features such as template creation, real-time collaboration, invite links, secret notes, and activity history free of charge.</li>
        <li>We may add or change features to improve the Service.</li>
        <li>The Service may be temporarily suspended or limited when unavoidable, for example during maintenance, outages, or when usage limits are exceeded.</li>
        <li>If we discontinue the Service, we will post a notice in the Service 30 days in advance.</li>
      </ol>

      <h2>Article 7 (Rights and responsibilities for Content)</h2>
      <ol>
        <li>Rights to Content belong to the member who created it (or to its co-authors, if several people created it together).</li>
        <li>We use Content only to the extent necessary to provide the Service, such as storing, transmitting, and displaying it, and not for any other purpose.</li>
        <li>
          Content in a shared space can be viewed by all members of that template and edited according to their roles. Members are responsible for deciding whom to invite and for managing
          their invite links.
        </li>
        <li>You must ensure that your Content does not violate any law or the rights of others, and you are responsible for any consequences of failing to do so.</li>
      </ol>

      <h2>Article 8 (Data storage and secret notes)</h2>
      <ol>
        <li>
          Templates are stored on our servers so you can continue working from any device you sign in on. Content created while you are offline is saved once you reconnect.
        </li>
        <li>Deleted templates are kept in Trash for 30 days, during which the owner can restore them. After that, they are permanently deleted and cannot be recovered.</li>
        <li>Versions of template content are saved at regular intervals, and you can make a copy from any version within the retention period (up to 30 days).</li>
        <li>Secret notes can be opened only with their password, and even we cannot see their content. If you forget the password, the content cannot be recovered.</li>
      </ol>

      <h2>Article 9 (Prohibited conduct)</h2>
      <p>Members must not:</p>
      <ul>
        <li>Create or share Content that violates the law or is contrary to public order or morals</li>
        <li>Infringe the rights of others, including copyrights and personal information</li>
        <li>Upload malicious code or misuse the code execution features</li>
        <li>Interfere with the operation of the Service through excessive requests, automated tools, or similar means</li>
        <li>Attempt to access another person’s templates or account without authorization</li>
        <li>Impersonate others or send spam or advertising</li>
      </ul>

      <h2>Article 10 (Restrictions on use)</h2>
      <p>
        If a member violates these Terms, we may restrict their use of the Service or delete the relevant Content after giving prior notice. However, in urgent cases where action is
        needed to prevent serious harm to other users or the Service, we may act first and notify the member afterward.
      </p>

      <h2>Article 11 (Account deletion)</h2>
      <p>
        You may request account deletion at any time by emailing {mail}, and we will process your request without delay after verifying your identity. After deletion, your personal
        information is handled in accordance with the Privacy Policy.
      </p>

      <h2>Article 12 (Limitation of liability)</h2>
      <ol>
        <li>
          The Service is provided free of charge and “as is.” We are not liable for damages that do not result from our intentional misconduct or gross negligence, such as natural
          disasters, member error, or outages of external services (including hosting and sign-in providers).
        </li>
        <li>Disputes between members, or between a member and a third party, must be resolved between the parties involved.</li>
        <li>Members are responsible for backing up their own important Content.</li>
      </ol>

      <h2>Article 13 (Governing law and jurisdiction)</h2>
      <p>
        These Terms are governed by the laws of the Republic of Korea, and any dispute relating to the Service will be resolved by the court with jurisdiction under the Korean Civil
        Procedure Act.
      </p>

      <h2>Article 14 (Contact)</h2>
      <p>Please send any questions about using the Service to {mail}.</p>
      <p className="legal-meta">Supplementary provision: These Terms take effect on {enDate(effectiveDate)}.</p>
    </>
  );
}

/** 위쪽 한 줄: 시행일 · 운영 · 문의 */
export function MetaEn({ effectiveDate }: { effectiveDate: string }) {
  return (
    <p className="legal-meta">
      Effective {enDate(effectiveDate)} · Operated by {OPERATOR_EN} · Contact: {mail}
    </p>
  );
}
