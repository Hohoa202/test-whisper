using WebApplicationBase.Data;
using WebApplicationBase.Models.Entity.Db2;
using WebApplicationBase.Repositories.Db2.IRepository;

namespace WebApplicationBase.Repositories.Db2
{
    public class MstEtcRepository : Repository<T_Mst_Etc>, IMstEtcRepository
    {
        private AppDb2Context _db;
        private readonly IHttpContextAccessor _httpCtAsor;
        public MstEtcRepository(AppDb2Context db, IHttpContextAccessor httpCtAsor) : base(db)
        {
            _db = db;
            _httpCtAsor = httpCtAsor;
        }
    }
}