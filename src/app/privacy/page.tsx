import Link from "next/link";

export default function PrivacyPage() {
  const contact = process.env.NEXT_PUBLIC_PRIVACY_EMAIL;
  return <main className="legal-page">
    <Link className="back-link" href="/login">Voltar</Link>
    <p className="eyebrow">PRIVACIDADE</p><h1>Aviso de privacidade</h1>
    <p>Este aviso descreve o funcionamento do beta do Arcadya Finanças. A identificação legal de quem opera o serviço e um canal de privacidade precisam ser preenchidos antes da abertura pública.</p>
    <h2>Dados tratados</h2>
    <p>O serviço usa seu e-mail para autenticação e recuperação da conta. Mensagens, categorias, carteiras, saldos, movimentações, recorrências e os anexos que você envia ficam associados à sua conta. O app não acessa contas bancárias.</p>
    <h2>Onde e como são processados</h2>
    <p>O banco e os anexos são armazenados em um projeto privado do Supabase. O site é servido pela Discloud. O Supabase Auth envia mensagens de confirmação e recuperação de senha pelo provedor SMTP configurado. Os provedores recebem os dados mínimos necessários para essas funções.</p>
    <p>Para interpretar mensagens e anexos, o serviço entrega o texto e, quando necessário, arquivos temporariamente ao processador local configurado pela operação do beta. Esse computador roda OCR, Whisper e Ollama. O conteúdo financeiro não é enviado a uma API de IA externa. Arquivos temporários são removidos após o processamento; anexos originais permanecem no armazenamento privado até a exclusão da conta.</p>
    <h2>Retenção e controles</h2>
    <p>Os dados permanecem associados à conta enquanto ela existir. Em <Link href="/account">Conta e dados</Link>, você pode baixar uma exportação ou excluir a conta. Cópias de segurança criptografadas podem permanecer no computador usado pela operação do beta até serem removidas.</p>
    <p>O beta limita anexos a 30 MB armazenados e 100 MB processados por conta a cada mês. O serviço não usa ferramentas de análise de comportamento ou publicidade.</p>
    <h2>Contato e operador</h2>
    {contact ? <p>Contato para assuntos de privacidade: <a href={`mailto:${contact}`}>{contact}</a>.</p> : <p className="legal-incomplete">Canal de privacidade não configurado. O lançamento público deve aguardar a inclusão do e-mail de contato e dos dados legais da pessoa controladora.</p>}
    <p className="legal-updated">Última atualização: 30 de setembro de 2026.</p>
  </main>;
}
